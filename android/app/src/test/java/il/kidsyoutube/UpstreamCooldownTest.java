// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import java.io.IOException;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.Test;
import static org.junit.Assert.*;

public final class UpstreamCooldownTest {
    @Test public void realProviderBlockThenRepeatedLocalDenialsNeverExtendDeadline() throws Exception {
        AtomicLong clock=new AtomicLong(1000000);
        NativeApi api=new NativeApi(new ExtractorDownloader(false),
                "https://example.invalid/grants",clock::get);
        IOException original=new IOException("UPSTREAM_BLOCKED");
        api.recordFailure(original);
        assertEquals(UpstreamCooldown.BLOCK_MS,api.cooldownRemainingMs());

        clock.addAndGet(10*1000L);
        for(int click=0;click<25;click++){
            try{
                api.checkNetwork();
                fail("local block must prevent NewPipe fetch");
            }catch(UpstreamCooldown.ActiveException denied){
                assertEquals("COOLDOWN_ACTIVE",NativeApi.errorCode(denied));
                assertTrue(denied.remainingMs>0);
                api.recordFailure(denied); // request/playback catch
                api.recordFailure(new IOException("wrapper",denied)); // another layer
                assertEquals(denied.remainingMs,api.cooldownRemainingMs());
            }
            clock.addAndGet(1000);
        }
        assertEquals(UpstreamCooldown.BLOCK_MS-35*1000L,api.cooldownRemainingMs());
        clock.set(1000000+UpstreamCooldown.BLOCK_MS);
        api.checkNetwork(); // no local refusal after exact deadline
        assertEquals(0,api.cooldownRemainingMs());
    }

    @Test public void sameUpstreamExceptionRecordedTwiceDoesNotExtendBlock() throws Exception {
        AtomicLong clock=new AtomicLong(5000);
        UpstreamCooldown gate=new UpstreamCooldown(clock::get);
        IOException blocked=new IOException("UPSTREAM_BLOCKED");
        gate.record(blocked,"UPSTREAM_BLOCKED");
        clock.addAndGet(20*1000L);
        gate.record(blocked,"UPSTREAM_BLOCKED");
        assertEquals(UpstreamCooldown.BLOCK_MS-20*1000L,gate.remainingMs());
        // A genuinely NEW response is allowed to restart protection.
        gate.record(new IOException("UPSTREAM_BLOCKED"),"UPSTREAM_BLOCKED");
        assertEquals(UpstreamCooldown.BLOCK_MS,gate.remainingMs());
    }

    @Test public void realRateLimitAndRealBlockKeepDistinctDurations() throws Exception {
        AtomicLong clock=new AtomicLong(10);
        UpstreamCooldown gate=new UpstreamCooldown(clock::get);
        IOException rate=new IOException("RATE_LIMITED");
        gate.record(rate,"RATE_LIMITED");
        assertEquals(UpstreamCooldown.RATE_LIMIT_MS,gate.remainingMs());
        clock.addAndGet(30000);
        gate.record(rate,"RATE_LIMITED");
        assertEquals(90000,gate.remainingMs());
        gate.record(new IOException("UPSTREAM_BLOCKED"),"UPSTREAM_BLOCKED");
        // A new 60-second block cannot shorten a pre-existing 90-second rate-limit.
        assertEquals(90000,gate.remainingMs());
        clock.addAndGet(45000);
        gate.record(new IOException("RATE_LIMITED"),"RATE_LIMITED");
        assertEquals(UpstreamCooldown.RATE_LIMIT_MS,gate.remainingMs());
    }

    @Test public void cooldownSurvivesCacheClearAndDoesNotBypassFreshGrants() throws Exception {
        AtomicLong clock=new AtomicLong(900000);
        NativeApi api=new NativeApi(new ExtractorDownloader(false),
                "https://example.invalid/grants",clock::get);
        api.recordFailure(new IOException("UPSTREAM_BLOCKED"));
        api.clear();
        assertEquals(UpstreamCooldown.BLOCK_MS,api.cooldownRemainingMs());
        try{api.checkNetwork();fail("clear cannot bypass provider protection");}
        catch(UpstreamCooldown.ActiveException expected){}
        clock.addAndGet(UpstreamCooldown.BLOCK_MS);
        api.checkNetwork();
        assertEquals(0,api.cooldownRemainingMs());
    }

    @Test public void localDenialCannotBeMistakenForProviderBlockEvenIfWrapped() {
        AtomicLong clock=new AtomicLong(0);
        UpstreamCooldown gate=new UpstreamCooldown(clock::get);
        IOException upstream=new IOException("UPSTREAM_BLOCKED");
        gate.record(upstream,"UPSTREAM_BLOCKED");
        clock.addAndGet(10000);
        UpstreamCooldown.ActiveException local=null;
        try{gate.check();fail();}
        catch(UpstreamCooldown.ActiveException expected){local=expected;}
        assertNotNull(local);
        assertEquals("COOLDOWN_ACTIVE",NativeApi.errorCode(
                new IOException("UPSTREAM_BLOCKED",local)));
        gate.record(new IOException("UPSTREAM_BLOCKED",local),"UPSTREAM_BLOCKED");
        assertEquals(UpstreamCooldown.BLOCK_MS-10000,gate.remainingMs());
    }
}
