// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import java.io.IOException;
import java.net.SocketTimeoutException;
import androidx.media3.common.C;
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy;
import org.junit.Test;
import static org.junit.Assert.*;

/** Verify the real Media3 retry decision, not just the source-switch UI. */
public final class MediaSourceLoadPolicyTest {
    private static LoadErrorHandlingPolicy.LoadErrorInfo failure(IOException error,int count){
        // Only exception and errorCount are used by the Media3 retry policy.
        return new LoadErrorHandlingPolicy.LoadErrorInfo(null,null,error,count);
    }
    @Test public void explicit401403429AreFatalForThatExactMediaSource(){
        MediaSourceLoadPolicy policy=new MediaSourceLoadPolicy();
        for(int status:new int[]{401,403,429}){
            for(String role:new String[]{"audio","video"}){
                IOException wrapped=new IOException("Media3 wrapping",
                        new MediaHttpFailure(status,role));
                assertEquals(C.TIME_UNSET,policy.getRetryDelayMsFor(failure(wrapped,1)));
                assertEquals(C.TIME_UNSET,policy.getRetryDelayMsFor(failure(wrapped,4)));
                assertEquals(0,policy.getMinimumLoadableRetryCount(C.DATA_TYPE_MEDIA));
            }
        }
    }
    @Test public void transientReadTimeoutStillUsesNormalMedia3Policy(){
        MediaSourceLoadPolicy policy=new MediaSourceLoadPolicy();
        assertEquals(0,policy.getRetryDelayMsFor(failure(new SocketTimeoutException(),1)));
        assertEquals(1000,policy.getRetryDelayMsFor(failure(new SocketTimeoutException(),2)));
    }
    @Test public void signedQueryIsNotDiscardedOrDecodedByNativeSourceContainer(){
        String url="https://r1.googlevideo.com/videoplayback?expire=1999999999"+
                "&n=abc%2Bdef&sig=a%2Fb%3D&itag=18&pot=token%2Bbytes";
        NativeApi.Source fresh=new NativeApi.Source(url,null,240,300000);
        assertEquals(url,fresh.video);
        okhttp3.HttpUrl parsed=okhttp3.HttpUrl.parse(fresh.video);
        assertNotNull(parsed);
        assertEquals(url,parsed.toString());
        assertTrue(ApprovalPolicy.safeMedia(fresh.video));
    }
}
