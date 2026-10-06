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
        assertFalse(media.followRedirects());
        assertFalse(media.followSslRedirects());
        assertEquals(1,media.interceptors().size());
        assertEquals(0,media.networkInterceptors().size());
    }

    @Test public void redirectedMediaStillUsesStrictGooglevideoBoundary() throws Exception {
        okhttp3.HttpUrl current=okhttp3.HttpUrl.get("https://rr1.googlevideo.com/videoplayback?expire=1");
        assertEquals("rr2.googlevideo.com",
                MainActivity.safeMediaRedirect(current,"https://rr2.googlevideo.com/videoplayback?expire=2").host());
        assertEquals("rr1.googlevideo.com",
                MainActivity.safeMediaRedirect(current,"/next?expire=2").host());
        for(String location:new String[]{
                "http://rr2.googlevideo.com/videoplayback",
                "https://googlevideo.com.evil.example/videoplayback",
                "https://user@rr2.googlevideo.com/videoplayback",
                "https://rr2.googlevideo.com:444/videoplayback",
                "https://example.com/file"
        }) {
            try {MainActivity.safeMediaRedirect(current,location);fail(location);}
            catch(java.io.IOException expected) {assertEquals("INVALID_MEDIA_REDIRECT",expected.getMessage());}
        }
    }
}
