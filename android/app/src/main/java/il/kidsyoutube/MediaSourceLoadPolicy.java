// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import androidx.media3.common.C;
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy;
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy;

/**
 * A signed media URL's explicit HTTP 401/403/429 is terminal for that source.
 * DefaultLoadErrorHandlingPolicy(0) sets only the minimum retry count; its
 * getRetryDelayMsFor can still request retries for generic IOException.
 * Preserve the existing behavior for network interruptions and other errors.
 */
final class MediaSourceLoadPolicy extends DefaultLoadErrorHandlingPolicy {
    MediaSourceLoadPolicy(){super(0);}
    static boolean isPermanentSourceResponse(Throwable error){
        return MediaHttpFailure.find(error)!=null;
    }
    @Override public long getRetryDelayMsFor(LoadErrorHandlingPolicy.LoadErrorInfo info){
        return isPermanentSourceResponse(info.exception)
                ? C.TIME_UNSET : super.getRetryDelayMsFor(info);
    }
}
