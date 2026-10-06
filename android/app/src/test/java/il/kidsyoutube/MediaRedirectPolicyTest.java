// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import okhttp3.OkHttpClient;
import org.junit.Test;
import static org.junit.Assert.*;

public class MediaRedirectPolicyTest {
    @Test public void mediaClientFollowsOnlySameSchemeRedirects() {
        OkHttpClient base=new OkHttpClient.Builder()
                .followRedirects(false)
                .followSslRedirects(false)
                .build();
        OkHttpClient media=MainActivity.mediaClient(base);
        assertTrue(media.followRedirects());
        assertFalse(media.followSslRedirects());
        assertEquals(1,media.networkInterceptors().size());
    }

    @Test public void redirectedMediaStillUsesStrictGooglevideoBoundary() {
        assertTrue(ApprovalPolicy.safeMedia("https://rr2---sn.example.googlevideo.com/videoplayback?expire=1"));
        assertFalse(ApprovalPolicy.safeMedia("http://rr2---sn.example.googlevideo.com/videoplayback"));
        assertFalse(ApprovalPolicy.safeMedia("https://googlevideo.com.evil.example/videoplayback"));
        assertFalse(ApprovalPolicy.safeMedia("https://user@rr2.googlevideo.com/videoplayback"));
        assertFalse(ApprovalPolicy.safeMedia("https://rr2.googlevideo.com:444/videoplayback"));
    }
}
