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
        // A real TCP listener is retained for the whole test. MockWebServer's
        // queued socket teardown can interfere with a second call after a
        // deliberate read timeout; this controlled HTTP/1.1 peer accepts two
        // distinct connections without rebuilding the client or listener.
        java.net.InetAddress localhost=java.net.InetAddress.getByName("127.0.0.1");
        try(java.net.ServerSocket server=new java.net.ServerSocket(0,8,localhost)){
            server.setSoTimeout(5000);
            AtomicInteger http=new AtomicInteger(),dns=new AtomicInteger();
            ExecutorService peer=Executors.newSingleThreadExecutor();
            Future<?> served=peer.submit(()->{
                try{
                    for(int n=0;n<2;n++){
                        try(java.net.Socket socket=server.accept()){
                            socket.setSoTimeout(1500);
                            java.io.BufferedReader input=new java.io.BufferedReader(
                                new java.io.InputStreamReader(socket.getInputStream(),
                                java.nio.charset.StandardCharsets.US_ASCII));
                            while(true){
                                String line=input.readLine();
                                if(line==null||line.isEmpty())break;
                            }
                            int received=http.incrementAndGet();
                            if(received==1){Thread.sleep(650);continue;} // no status / headers
                            byte[] body=document(4).getBytes(java.nio.charset.StandardCharsets.UTF_8);
                            String headers="HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\n"+
                                "Content-Length: "+body.length+"\\r\\nConnection: close\\r\\n\\r\\n";
                            socket.getOutputStream().write(headers.getBytes(
                                java.nio.charset.StandardCharsets.US_ASCII));
                            socket.getOutputStream().write(body);
                            socket.getOutputStream().flush();
                        }
                    }
                }catch(Exception e){throw new RuntimeException(e);}
            });
            try{
                Dns flaky=name->{
                    if(dns.incrementAndGet()<=4)throw new UnknownHostException("temporary DNS");
                    return java.util.Collections.singletonList(localhost);
                };
                NativeApi api=new NativeApi(new ExtractorDownloader(false,flaky,220),
                    "http://127.0.0.1:"+server.getLocalPort()+"/?action=list&format=native");
                for(int cycle=0;cycle<2;cycle++){
                    try{api.whitelist(true,false);fail("two DNS failures must fail closed");}
                    catch(UnknownHostException expected){}
                    assertEquals(0,http.get());
                }
                assertEquals(4,dns.get());
                try{api.whitelist(true,false);fail("no headers must never grant");}
                catch(java.net.SocketTimeoutException expected){}
                assertEquals(1,http.get());
                assertEquals(5,dns.get());
                Thread.sleep(700); // release deliberately stalled first connection
                assertTrue(api.whitelist(true,false).contains("AAAAAAAAAAA"));
                assertEquals(6,dns.get());
                assertEquals(2,http.get());
                assertTrue(api.whitelist(false,false).contains("AAAAAAAAAAA"));
                assertEquals(2,http.get()); // cache after fresh grant, no extra GET
                served.get(2,TimeUnit.SECONDS);
            }finally{
                peer.shutdownNow();
                assertTrue(peer.awaitTermination(3,TimeUnit.SECONDS));
            }
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
