// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import java.io.IOException;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.Test;
import static org.junit.Assert.*;

/**
 * Uses real production OkHttp and NativeApi.whitelist(), with only the HTTP
 * peer replaced by an in-process server. No TLS validation or client settings
 * are changed in production.
 */
public final class NativeAuthorizationTransportTest {
    private static String document(String video,int version) {
        return "{\"list\":\"https://www.youtube.com/watch?v="+video+
            "\\n\",\"version\":"+version+
            ",\"updatedAt\":\"2026-10-09T00:00:00Z\",\"catalogVersion\":1}";
    }

    @Test public void slowOlderRequestCannotBlockOrOverwriteNewerAuthorization() throws Exception {
        try(MockWebServer server=new MockWebServer()) {
            CountDownLatch firstReceived=new CountDownLatch(1);
            CountDownLatch releaseFirst=new CountDownLatch(1);
            CountDownLatch secondReceived=new CountDownLatch(1);
            AtomicInteger order=new AtomicInteger();
            server.setDispatcher(new Dispatcher(){
                @Override public MockResponse dispatch(RecordedRequest request) throws InterruptedException {
                    if(order.incrementAndGet()==1){
                        firstReceived.countDown();
                        if(!releaseFirst.await(5,TimeUnit.SECONDS))
                            return new MockResponse().setResponseCode(504);
                        return new MockResponse().setBody(document("mVTlbvQ_010",1));
                    }
                    secondReceived.countDown();
                    return new MockResponse().setBody(document("AAAAAAAAAAA",2));
                }
            });
            server.start();
            NativeApi api=new NativeApi(new ExtractorDownloader(false),server.url("/?action=list").toString());
            ExecutorService workers=Executors.newFixedThreadPool(2);
            try {
                Future<String> earlier=workers.submit(()->api.whitelist(true));
                assertTrue("first wire request did not start",firstReceived.await(2,TimeUnit.SECONDS));
                Future<String> newer=workers.submit(()->api.whitelist(true));
                // Under the previous synchronized whitelist implementation the
                // second request cannot reach the HTTP server until the first
                // (held) response completes. This assertion fails pre-fix.
                assertTrue("second authority blocked behind old TLS/HTTP call",
                        secondReceived.await(2,TimeUnit.SECONDS));
                assertTrue(newer.get(2,TimeUnit.SECONDS).contains("AAAAAAAAAAA"));
                releaseFirst.countDown();
                try {
                    earlier.get(2,TimeUnit.SECONDS);
                    fail("stale authority must never be accepted");
                }catch(ExecutionException expected){
                    assertTrue(String.valueOf(expected.getCause()).contains("AUTH_SUPERSEDED"));
                }
                String latest=api.whitelist(false);
                assertTrue(latest.contains("AAAAAAAAAAA"));
                assertFalse(latest.contains("mVTlbvQ_010"));
            } finally {
                releaseFirst.countDown();
                workers.shutdownNow();
                assertTrue(workers.awaitTermination(6,TimeUnit.SECONDS));
            }
        }
    }

    @Test public void failedFreshAuthorizationCannotFallBackToPreviousDocument() throws Exception {
        try(MockWebServer server=new MockWebServer()){
            server.enqueue(new MockResponse().setBody(document("mVTlbvQ_010",1)));
            server.enqueue(new MockResponse().setResponseCode(503).setBody("unavailable"));
            server.start();
            NativeApi api=new NativeApi(new ExtractorDownloader(false),server.url("/?action=list").toString());
            assertTrue(api.whitelist(true).contains("mVTlbvQ_010"));
            try{api.displayAuthorization();fail("must fail closed");}
            catch(IOException expected){assertTrue(expected.getMessage().contains("WHITELIST_UNAVAILABLE"));}
            try{
                api.sharedCatalog(new org.json.JSONObject().put("version",1)
                    .put("updatedAt","2026-10-09T00:00:00Z"));
                fail("cached authorization must not grant catalog access after fresh failure");
            }catch(IOException expected){assertTrue(expected.getMessage().contains("CATALOG_AUTH_CHANGED"));}
        }
    }

    @Test public void actualClientTimeoutAndRetryPoliciesRemainStrict(){
        ExtractorDownloader transport=new ExtractorDownloader(false);
        assertEquals(5000,transport.client.connectTimeoutMillis());
        assertEquals(8000,transport.client.readTimeoutMillis());
        assertEquals(12000,transport.client.callTimeoutMillis());
        assertFalse(transport.client.retryOnConnectionFailure());
        assertFalse(transport.client.followRedirects());
        assertNotNull(transport.client.connectionPool());
    }
    @Test public void realOkHttpFailsWithinPerCallDeadlineWhenServerNeverResponds() throws Exception {
        try(MockWebServer server=new MockWebServer()){
            server.enqueue(new MockResponse().setSocketPolicy(
                    okhttp3.mockwebserver.SocketPolicy.NO_RESPONSE));
            server.start();
            ExtractorDownloader transport=new ExtractorDownloader(false);
            okhttp3.Call call=transport.client.newCall(new okhttp3.Request.Builder()
                    .url(server.url("/list")).build());
            call.timeout().timeout(450,TimeUnit.MILLISECONDS);
            long start=System.nanoTime();
            try(okhttp3.Response ignored=call.execute()){
                fail("a stalled header response must not become an authorization success");
            }catch(IOException expected){
                long elapsed=TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-start);
                assertTrue("elapsed="+elapsed,elapsed<2200);
            }
        }
    }

    @Test public void productionClientNeverTrustsAnUntrustedTlsEndpoint() throws Exception {
        try(MockWebServer server=new MockWebServer()){
            okhttp3.tls.HeldCertificate certificate=new okhttp3.tls.HeldCertificate.Builder()
                    .addSubjectAlternativeName("localhost").build();
            okhttp3.tls.HandshakeCertificates serverCerts=
                    new okhttp3.tls.HandshakeCertificates.Builder()
                            .heldCertificate(certificate).build();
            server.useHttps(serverCerts.sslSocketFactory(),false);
            server.enqueue(new MockResponse().setBody(document("mVTlbvQ_010",1)));
            server.start();
            ExtractorDownloader production=new ExtractorDownloader(false);
            try(okhttp3.Response ignored=production.client.newCall(
                    new okhttp3.Request.Builder().url(server.url("/")).build()).execute()){
                fail("untrusted TLS certificates must never be accepted");
            }catch(javax.net.ssl.SSLException expected){
                // Must fail certificate verification with normal production TLS policy.
            }
        }
    }

}
