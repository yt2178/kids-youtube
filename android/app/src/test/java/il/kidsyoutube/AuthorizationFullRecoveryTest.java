// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import java.io.IOException;
import java.net.UnknownHostException;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.Dns;
import okhttp3.mockwebserver.*;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

/**
 * The SAME NativeApi, ExtractorDownloader, DNS state and HTTP service survive
 * four resolver failures, a no-header response, and a fresh successful grant.
 * HTTP only: this exercises deadlines/authorization, not real TLS handshakes.
 */
public final class AuthorizationFullRecoveryTest {
    private static final String VIDEO="https://www.youtube.com/watch?v=AAAAAAAAAAA\\n";
    private static String document(int version){
        return "{\"list\":\""+VIDEO+"\",\"version\":"+version+
                ",\"updatedAt\":\"2026-10-11T00:00:00Z\",\"catalogVersion\":1}";
    }
    @Test public void dnsFourThenHeadersTimeoutThenFreshSuccessSameClient() throws Exception {
        try(MockWebServer server=new MockWebServer()){
            AtomicInteger http=new AtomicInteger(),dns=new AtomicInteger();
            server.setDispatcher(new Dispatcher(){
                @Override public MockResponse dispatch(RecordedRequest request) {
                    if(http.incrementAndGet()==1) return new MockResponse()
                        .setHeadersDelay(650,TimeUnit.MILLISECONDS)
                        .setBody(document(3));
                    return new MockResponse().setBody(document(4));
                }
            });
            server.start();
            Dns flaky=name->{
                if(dns.incrementAndGet()<=4)throw new UnknownHostException("intermittent resolver");
                return Dns.SYSTEM.lookup(name);
            };
            NativeApi api=new NativeApi(new ExtractorDownloader(false,flaky,220),
                    server.url("/?action=list&format=native").toString());
            for(int cycle=0;cycle<2;cycle++){
                try{api.whitelist(true,false);fail("two attempts must fail closed");}
                catch(UnknownHostException expected){}
                assertEquals(0,server.getRequestCount());
            }
            assertEquals(4,dns.get());
            try{api.whitelist(true,false);fail("no HTTP headers must not grant");}
            catch(java.net.SocketTimeoutException expected){}
            assertEquals(1,http.get());
            assertEquals(5,dns.get());
            // The server remains up; allow its first deliberately delayed
            // response to finish before trying the next fresh authorization.
            Thread.sleep(730);
            assertTrue(api.whitelist(true,false).contains("AAAAAAAAAAA"));
            assertEquals(6,dns.get());
            assertEquals(2,http.get());
            JSONObject response=api.displayAuthorization(); // another fresh GET
            assertEquals(4,response.getInt("version"));
            assertEquals(3,http.get()); // no stale grant or extra internal retry
        }
    }

    @Test public void cancellingWhileWaitingForInnerRetryStopsFurtherDnsAndLateCommit() throws Exception {
        try(MockWebServer server=new MockWebServer()){
            server.start();
            AtomicInteger lookups=new AtomicInteger();
            CountDownLatch first=new CountDownLatch(1);
            Dns flaky=name->{lookups.incrementAndGet();first.countDown();
                throw new UnknownHostException("temporary dns");};
            NativeApi api=new NativeApi(new ExtractorDownloader(false,flaky),
                    server.url("/?action=list&format=native").toString());
            RequestScope scope=new RequestScope(1500,"2",1,1);
            ExecutorService threads=Executors.newSingleThreadExecutor();
            try{
                Future<String> f=threads.submit(()->{
                    scope.enter();
                    try{return api.whitelist(true,false);}
                    finally{scope.close();}
                });
                assertTrue(first.await(2,TimeUnit.SECONDS));
                scope.cancel(); // may happen during the 350ms backoff
                try{f.get(3,TimeUnit.SECONDS);fail("cancelled grant should fail");}
                catch(ExecutionException expected){
                    assertTrue(expected.getCause() instanceof IOException);
                }
                assertEquals(1,lookups.get());
                assertEquals(0,server.getRequestCount());
            }finally{scope.cancel();threads.shutdownNow();
                assertTrue(threads.awaitTermination(4,TimeUnit.SECONDS));}
        }
    }

    @Test public void cancellingDuringSlowBodyReadNeverCommitsLateGrants() throws Exception {
        try(MockWebServer server=new MockWebServer()){
            server.enqueue(new MockResponse()
                .setBodyDelay(700,TimeUnit.MILLISECONDS).setBody(document(8)));
            server.start();
            NativeApi api=new NativeApi(new ExtractorDownloader(false),
                server.url("/?action=list&format=native").toString());
            RequestScope scope=new RequestScope(1700,"3",1,1);
            ExecutorService threads=Executors.newSingleThreadExecutor();
            try{
                Future<String> f=threads.submit(()->{
                    scope.enter();try{return api.whitelist(true,false);}
                    finally{scope.close();}
                });
                assertNotNull(server.takeRequest(2,TimeUnit.SECONDS));
                scope.cancel();
                try{f.get(3,TimeUnit.SECONDS);fail("cancelled body must not grant");}
                catch(ExecutionException expected){assertTrue(expected.getCause() instanceof IOException);}
                try{api.sharedCatalog(new JSONObject()
                    .put("version",8).put("updatedAt","2026-10-11T00:00:00Z"));
                    fail("no stale catalog after abort");
                }catch(IOException expected){
                    assertTrue(expected.getMessage().contains("CATALOG_AUTH_CHANGED"));
                }
            }finally{scope.cancel();threads.shutdownNow();
                assertTrue(threads.awaitTermination(4,TimeUnit.SECONDS));}
        }
    }
}
