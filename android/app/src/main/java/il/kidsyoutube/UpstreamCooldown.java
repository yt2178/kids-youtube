// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import java.io.IOException;
import java.util.WeakHashMap;
import java.util.function.LongSupplier;

/**
 * Shared provider-protection cooldown for NewPipe video, channel and metadata.
 * A local refusal is NOT evidence of another upstream block.
 * Package-local clock injection keeps expiry tests deterministic.
 */
final class UpstreamCooldown {
    static final long BLOCK_MS=15*60*1000L;
    static final long RATE_LIMIT_MS=2*60*1000L;

    static final class ActiveException extends IOException {
        final long remainingMs;
        ActiveException(long remainingMs){
            super("COOLDOWN_ACTIVE");
            this.remainingMs=remainingMs;
        }
    }

    private final LongSupplier clock;
    private final WeakHashMap<Throwable,Boolean> recorded=new WeakHashMap<>();
    private long untilMs;

    UpstreamCooldown(LongSupplier clock){this.clock=clock;}

    synchronized long remainingMs(){
        return Math.max(0,untilMs-clock.getAsLong());
    }

    synchronized void check() throws ActiveException {
        long remaining=remainingMs();
        if(remaining>0)throw new ActiveException(remaining);
    }

    synchronized void record(Throwable event,String code){
        if(event==null||(!"UPSTREAM_BLOCKED".equals(code)&&!"RATE_LIMITED".equals(code)))return;
        for(Throwable cause=event;cause!=null;cause=cause.getCause())
            if(cause instanceof ActiveException)return;
        // The same exception can bubble through more than one Java layer.
        if(recorded.containsKey(event))return;
        recorded.put(event,Boolean.TRUE);
        long duration="UPSTREAM_BLOCKED".equals(code)?BLOCK_MS:RATE_LIMIT_MS;
        long next=clock.getAsLong()+duration;
        // A shorter rate-limit report cannot prematurely end a real 15m block.
        untilMs=Math.max(untilMs,next);
    }
}
