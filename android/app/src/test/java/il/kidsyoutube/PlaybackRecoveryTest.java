// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import java.io.IOException;
import java.net.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import static org.junit.Assert.*;

public class PlaybackRecoveryTest {
    @Test public void extractorDnsFailsOnceThenTwoFreshAuthorizationChecksAgain() throws Exception {
        RequestScope scope=new RequestScope(85000,"player",0,0);
        AtomicInteger before=new AtomicInteger(),extract=new AtomicInteger(),after=new AtomicInteger();
        List<String> stages=new ArrayList<>();
        try{
            String result=PlaybackRecovery.run(scope,()->{
                before.incrementAndGet(); // fresh grant BEFORE each extraction attempt
                int call=extract.incrementAndGet();
                if(call==1)throw new UnknownHostException("provider route temporarily down");
                after.incrementAndGet(); // fresh grant AFTER extraction
                return "valid-media";
            },stages::add);
            assertEquals("valid-media",result);
            assertEquals(2,before.get());
            assertEquals(2,extract.get());
            assertEquals(1,after.get());
            assertEquals(List.of("DNS_ERROR"),stages);
        }finally{scope.close();}
    }
    @Test public void initialAuthHeaderTimeoutCanRecoverWithoutSkippingSecondGrant() throws Exception {
        RequestScope scope=new RequestScope(85000);
        AtomicInteger before=new AtomicInteger(),after=new AtomicInteger(),extraction=new AtomicInteger();
        try{
            String sources=PlaybackRecovery.run(scope,()->{
                if(before.incrementAndGet()==1)throw new SocketTimeoutException("headers absent");
                extraction.incrementAndGet();
                after.incrementAndGet();
                return "ready";
            },null);
            assertEquals("ready",sources);
            assertEquals(2,before.get());
            assertEquals(1,extraction.get());
            assertEquals(1,after.get());
        }finally{scope.close();}
    }
    @Test public void explicitRevocationAndTlsFailureNeverRetry() throws Exception {
        for(IOException e:List.of(new IOException("NOT_APPROVED"),
                new IOException("UPSTREAM_BLOCKED"),new IOException("RATE_LIMITED"),
                new javax.net.ssl.SSLHandshakeException("certificate invalid"))){
            RequestScope scope=new RequestScope(85000);
            AtomicInteger attempts=new AtomicInteger();
            try{
                try{
                    PlaybackRecovery.run(scope,()->{attempts.incrementAndGet();throw e;},null);
                    fail("must reject denied/restricted video");
                }catch(IOException expected){assertSame(e,expected);}
                assertEquals(e.getMessage(),1,attempts.get());
            }finally{scope.close();}
        }
    }
    @Test public void cancelledDuringBackoffDoesNotStartSecondPreparation() throws Exception {
        RequestScope scope=new RequestScope(85000);
        AtomicInteger attempts=new AtomicInteger();
        java.util.concurrent.CountDownLatch noticed=new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.ExecutorService executor=java.util.concurrent.Executors.newSingleThreadExecutor();
        try{
            java.util.concurrent.Future<String> f=executor.submit(()->PlaybackRecovery.run(scope,()->{
                attempts.incrementAndGet();throw new UnknownHostException("temporary");
            },code->noticed.countDown()));
            assertTrue(noticed.await(2,java.util.concurrent.TimeUnit.SECONDS));
            scope.cancel();
            try{f.get(4,java.util.concurrent.TimeUnit.SECONDS);fail("cancel must fail closed");}
            catch(java.util.concurrent.ExecutionException expected){
                assertTrue(expected.getCause() instanceof java.io.InterruptedIOException);
            }
            assertEquals(1,attempts.get());
        }finally{scope.cancel();executor.shutdownNow();scope.close();}
    }
    @Test public void noSecondAttemptIfTotalScopeHasInsufficientRemainingTime() throws Exception {
        RequestScope scope=new RequestScope(1500);
        AtomicInteger attempts=new AtomicInteger();
        try{
            try{
                PlaybackRecovery.run(scope,()->{
                    attempts.incrementAndGet();
                    throw new SocketTimeoutException("no headers");
                },null);
                fail();
            }catch(SocketTimeoutException expected){}
            assertEquals(1,attempts.get());
        }finally{scope.close();}
    }
}
