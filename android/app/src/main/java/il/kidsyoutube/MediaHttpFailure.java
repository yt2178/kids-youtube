// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import java.io.IOException;

/**
 * One HTTP response from a signed media source, not a NewPipe upstream ban.
 * Contains only the HTTP status and a fixed track role, never a signed URL.
 */
final class MediaHttpFailure extends IOException {
    final int status;
    final String track;

    MediaHttpFailure(int status,String track){
        super("MEDIA_HTTP_"+status);
        this.status=status;
        this.track="audio".equals(track)?"audio":"video";
    }

    static MediaHttpFailure find(Throwable failure){
        for(Throwable current=failure;current!=null;current=current.getCause())
            if(current instanceof MediaHttpFailure)return (MediaHttpFailure)current;
        return null;
    }

    /** Media-source HTTP errors NEVER imply a provider-wide extractor cooldown. */
    static String category(int status){
        return status==429?"MEDIA_SOURCE_RATE_LIMITED":"MEDIA_SOURCE_UNAVAILABLE";
    }

    /** At most one alternative media source after a 401/403 response. */
    static boolean canSwitch(int status,int priorSwitches,int nextIndex,int sourceCount){
        return (status==401||status==403)&&priorSwitches<1
                &&nextIndex<Math.min(6,sourceCount);
    }
}
