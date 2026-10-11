// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import java.io.IOException;
import java.net.UnknownHostException;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.Dns;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import okhttp3.mockwebserver.SocketPolicy;
import org.junit.Test;
import static org.junit.Assert.*;

/** Real OkHttp + real NativeApi authority, deterministic controlled network. */
public final class WeakNetworkTransportTest {
    static final String VIDEO="https://www.youtube.com/watch?v=AAAAAAAAAAA\\n";
    static String response(String list,int version,int padding) {
        StringBuilder result=new StringBuilder("{\"list\":\"").append(list)
            .append("\",\"version\":").append(version)
            .append(",\"updatedAt\":\"2026-10-11T00:00:00Z\",\"catalogVersion\":1,\"padding\":\"");
        for(int i=0;i<padding;i++)result.append('x');
        return result.append("\"}").toString();
    }
    @Test public void compactPollDoesNotAskForDisplayCatalog() throws Exception {
        try(MockWebServer server=new MockWebServer()){
            server.enqueue(new MockResponse().setBody(response(VIDEO,1,0)));
            server.enqueue(new MockResponse().setBody(response(VIDEO,1,0)));
            server.start();
            NativeApi api=new NativeApi(new ExtractorDownloader(false),server.url("/?action=list&format=native").toString());
            assertTrue(api.whitelist(true,true).contains("AAAAAAAAAAA"));
            assertTrue(api.whitelist(true,false).contains("AAAAAAAAAAA"));
            RecordedRequest full=server.takeRequest(2,TimeUnit.SECONDS);
            RecordedRequest compact=server.takeRequest(2,TimeUnit.SECONDS);
            assertNotNull(full);assertNotNull(compact);
            assertNull(full.getRequestUrl().queryParameter("detail"));
            assertEquals("grants",compact.getRequestUrl().queryParameter("detail"));
            assertEquals(2,server.getRequestCount());
        }
    }
    @Test public void simulated256KbpsDelayedChunksAreReadCompletely() throws Exception {
        try(MockWebServer server=new MockWebServer()){
            // 1024 B per 32 ms = 256 kbps; nonzero header delay simulates high RTT.
            server.enqueue(new MockResponse().setBody(response(VIDEO,4,16*1024))
                .setHeadersDelay(350,TimeUnit.MILLISECONDS)
                .throttleBody(1024,32,TimeUnit.MILLISECONDS));
            server.start();
            NativeApi api=new NativeApi(new ExtractorDownloader(false),server.url("/?action=list&format=native").toString());
            long start=System.nanoTime();
            assertTrue(api.whitelist(true,false).contains("AAAAAAAAAAA"));
            long ms=TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-start);
            assertTrue("response must actually be throttled, ms="+ms,ms>=350);
            assertTrue("bounded grant transfer, ms="+ms,ms<10000);
            assertEquals(1,server.getRequestCount());
        }
    }
    @Test public void simulated1MbpsThrottledBodyIsReadCompletely() throws Exception {
        try(MockWebServer server=new MockWebServer()){
            server.enqueue(new MockResponse().setBody(response(VIDEO,4,16*1024))
                .setHeadersDelay(150,TimeUnit.MILLISECONDS)
                .throttleBody(4096,32,TimeUnit.MILLISECONDS));
            server.start();
            NativeApi api=new NativeApi(new ExtractorDownloader(false),server.url("/?action=list&format=native").toString());
            assertTrue(api.whitelist(true,false).contains("AAAAAAAAAAA"));
            assertEquals(1,server.getRequestCount());
        }
    }
    @Test public void temporaryDnsFailureThenRecoveryNeverUsesStaleGrant() throws Exception {
        try(MockWebServer server=new MockWebServer()){
            server.enqueue(new MockResponse().setBody(response(VIDEO,2,0)));
            server.start();
            AtomicInteger lookups=new AtomicInteger();
            Dns flaky=name->{
                if(lookups.incrementAndGet()==1)throw new UnknownHostException("temporary DNS failure");
                return Dns.SYSTEM.lookup(name);
            };
            ExtractorDownloader network=new ExtractorDownloader(false,flaky);
            NativeApi api=new NativeApi(network,server.url("/?action=list&format=native").toString());
            // A single transient DNS failure is retried internally; neither
            // the failed lookup nor stale data can grant approval.
            assertTrue(api.whitelist(true,false).contains("AAAAAAAAAAA"));
            assertEquals(2,lookups.get());
            assertEquals(1,server.getRequestCount());
        }
    }
    @Test public void temporaryNetworkOutageThenRevokedGrantCannotKeepOldContent() throws Exception {
        try(MockWebServer server=new MockWebServer()){
            server.enqueue(new MockResponse().addHeader("Connection","close")
                    .setBody(response(VIDEO,1,0)));
            server.enqueue(new MockResponse().setBody(response("",2,0)));
            server.start();
            AtomicInteger lookups=new AtomicInteger();
            Dns flaky=name->{
                int attempt=lookups.incrementAndGet();
                if(attempt==2||attempt==3)throw new UnknownHostException("temporarily disconnected");
                return Dns.SYSTEM.lookup(name);
            };
            NativeApi api=new NativeApi(new ExtractorDownloader(false,flaky),
                    server.url("/?action=list&format=native").toString());
            assertTrue(api.whitelist(true,false).contains("AAAAAAAAAAA"));
            try{api.whitelist(true,false);fail("failed fresh check must never grant access");}
            catch(UnknownHostException expected){}
            assertEquals("",api.whitelist(true,false));
            assertEquals(2,server.getRequestCount());
        }
    }
    @Test public void socketFailureIsClassifiedAsTransportNotUnavailableVideo(){
        assertEquals("NETWORK_ERROR",NativeApi.errorCode(new java.net.SocketException("broken pipe")));
    }
    @Test public void fourDnsFailuresThenTlsConnectionWithNoHeadersThenRecovery() throws Exception {
        try(MockWebServer server=new MockWebServer()){
            // Four DNS errors are consumed in two app-level load cycles.
            // Fifth resolution reaches the server, whose first response
            // delays headers beyond read timeout; the next load recovers.
            server.enqueue(new MockResponse().setHeadersDelay(750,TimeUnit.MILLISECONDS)\n                    .setBody(response(VIDEO,8,0)));
            server.enqueue(new MockResponse().setBody(response(VIDEO,9,0)));
            server.start();
            AtomicInteger lookups=new AtomicInteger();
            Dns flaky=name->{
                int count=lookups.incrementAndGet();
                if(count<=4){
                    try{Thread.sleep(60);}catch(InterruptedException e){
                        Thread.currentThread().interrupt();
                        throw new UnknownHostException("interrupted");
                    }
                    throw new UnknownHostException("simulated intermittent DNS");
                }
                return Dns.SYSTEM.lookup(name);
            };
            NativeApi api=new NativeApi(new ExtractorDownloader(false,flaky,250),
                    server.url("/?action=list&format=native").toString());
            for(int load=0;load<2;load++){
                try{api.whitelist(true,false);fail("two DNS failures must not authorize");}
                catch(UnknownHostException expected){}
                assertEquals("DNS must not send any HTTP request",0,server.getRequestCount());
            }
            assertEquals(4,lookups.get());
            long started=System.nanoTime();
            try{api.whitelist(true,false);fail("no headers must not authorize");}
            catch(java.net.SocketTimeoutException expected){}
            long stalledMs=TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-started);
            assertTrue("headers stall should consume bounded time "+stalledMs,stalledMs>=200);
            assertEquals("header timeout is not retried inside same authorization",1,server.getRequestCount());
            assertEquals(5,lookups.get());
            Thread.sleep(850); // let the stalled mock response finish before reopening
            assertTrue(api.whitelist(true,false).contains("AAAAAAAAAAA"));
            assertEquals(2,server.getRequestCount());
        }
    }
    @Test public void sixSecondDnsFailureRetriesOnceWithinSingleGrantRequest() throws Exception {
        try(MockWebServer server=new MockWebServer()){
            server.enqueue(new MockResponse().setBody(response(VIDEO,7,0)));
            server.start();
            AtomicInteger lookups=new AtomicInteger();
            Dns slow=name->{
                if(lookups.incrementAndGet()==1){
                    try{Thread.sleep(6000);}catch(InterruptedException e){Thread.currentThread().interrupt();}
                    throw new UnknownHostException("6s DNS outage");
                }
                return Dns.SYSTEM.lookup(name);
            };
            NativeApi api=new NativeApi(new ExtractorDownloader(false,slow),
                    server.url("/?action=list&format=native").toString());
            long started=System.nanoTime();
            assertTrue(api.whitelist(true,false).contains("AAAAAAAAAAA"));
            long ms=TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-started);
            assertTrue("slow lookup must really last 6 seconds "+ms,ms>=5900);
            assertEquals(2,lookups.get());
            assertEquals(1,server.getRequestCount());
        }
    }
    @Test public void permissionDenialAndBadTlsAreNeverRetried() throws Exception {
        assertFalse(NativeApi.retryableAuthorizationTransport(new javax.net.ssl.SSLException("invalid cert")));
        assertFalse(NativeApi.retryableAuthorizationTransport(new java.net.SocketTimeoutException("headers")));
        assertFalse(NativeApi.retryableAuthorizationTransport(new IOException("WHITELIST_UNAVAILABLE")));
        assertTrue(NativeApi.retryableAuthorizationTransport(new UnknownHostException("dns")));
        assertTrue(NativeApi.retryableAuthorizationTransport(new java.net.ConnectException("connect")));
        try(MockWebServer server=new MockWebServer()){
            server.enqueue(new MockResponse().setResponseCode(403).setBody("no grants"));
            server.start();
            NativeApi api=new NativeApi(new ExtractorDownloader(false),
                    server.url("/?action=list&format=native").toString());
            try{api.whitelist(true,false);fail("HTTP 403 must fail closed");}
            catch(IOException expected){assertEquals("WHITELIST_UNAVAILABLE",expected.getMessage());}
            assertEquals(1,server.getRequestCount());
        }
    }
}
