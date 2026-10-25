// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import java.io.IOException;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Fail-closed experimental playback state machine. A permit is strictly bound
 * to one checked video and one authorization generation; it never authorizes
 * a different video or grants playback merely because a previous check passed.
 *
 * Production NativeApi/Media3 are NOT switched by this class. The actual media
 * boundary must invoke requireAuthorized before every start/resume/source switch.
 */
final class FamilyPlaybackLeaseGate {
    interface RemoteAuthorization {
        void authorize(String videoId) throws IOException;
    }
    private final RemoteAuthorization authorization;
    private final AtomicLong generation=new AtomicLong();
    private volatile Permit active;
    private final java.util.function.LongSupplier clock;
    private static final long PERMIT_TTL_MS=5000;
    static final class Permit {
        final long generation;
        final String videoId;
        final long expiresAt;
        private Permit(long g,String id,long expires){generation=g;videoId=id;expiresAt=expires;}
    }
    FamilyPlaybackLeaseGate(RemoteAuthorization authorization){
        this(authorization,System::currentTimeMillis);
    }
    FamilyPlaybackLeaseGate(RemoteAuthorization authorization,java.util.function.LongSupplier clock){
        if(authorization==null)throw new IllegalArgumentException("AUTH_REQUIRED");
        this.authorization=authorization;
        this.clock=clock;
    }
    synchronized Permit request(String videoId) throws IOException {
        active=null; // Any attempted switch invalidates the previous permit.
        long epoch=generation.incrementAndGet();
        if(videoId==null||!ApprovalPolicy.VIDEO.matcher(videoId).matches())
            throw new IOException("INVALID_VIDEO_ID");
        authorization.authorize(videoId);
        if(generation.get()!=epoch)throw new IOException("AUTH_SUPERSEDED");
        Permit granted=new Permit(epoch,videoId,clock.getAsLong()+PERMIT_TTL_MS);
        active=granted;
        return granted;
    }
    synchronized void requireAuthorized(Permit permit,String videoId) throws IOException {
        Permit current=active;
        if(permit==null||current==null||permit!=current ||
                generation.get()!=permit.generation ||
                clock.getAsLong()>=permit.expiresAt ||
                !permit.videoId.equals(videoId))
            throw new IOException("FAMILY_PLAYBACK_DENIED");
    }
    synchronized void invalidate(){
        active=null;
        generation.incrementAndGet();
    }
}
