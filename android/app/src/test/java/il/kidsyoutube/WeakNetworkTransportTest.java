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
            try{api.whitelist(true,false);fail("DNS error is not an authorization grant");}
            catch(UnknownHostException expected){}
            assertTrue(api.whitelist(true,false).contains("AAAAAAAAAAA"));
            assertTrue(lookups.get()>=2);
            assertEquals(1,server.getRequestCount());
        }
    }
    @Test public void disconnectThenRevokedGrantCannotKeepOldContent() throws Exception {
        try(MockWebServer server=new MockWebServer()){
            server.enqueue(new MockResponse().setBody(response(VIDEO,1,0)));
            server.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START));
            server.enqueue(new MockResponse().setBody(response("",2,0)));
            server.start();
            NativeApi api=new NativeApi(new ExtractorDownloader(false),server.url("/?action=list&format=native").toString());
            assertTrue(api.whitelist(true,false).contains("AAAAAAAAAAA"));
            try{api.whitelist(true,false);fail("connection loss must fail closed");}
            catch(IOException expected){}
            assertEquals("",api.whitelist(true,false));
        }
    }
    @Test public void socketFailureIsClassifiedAsTransportNotUnavailableVideo(){
        assertEquals("NETWORK_ERROR",NativeApi.errorCode(new java.net.SocketException("broken pipe")));
    }
}
