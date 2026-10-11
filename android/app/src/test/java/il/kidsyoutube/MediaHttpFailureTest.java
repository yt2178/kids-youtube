// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.Test;
import static org.junit.Assert.*;

/** Real OkHttp responses + modeled successful sources; not physical Media3 playback. */
public final class MediaHttpFailureTest {
    private static final String GRANTS="{\"list\":\"https://www.youtube.com/watch?v=AAAAAAAAAAA\\n\","
        +"\"version\":6,\"updatedAt\":\"2026-10-11T00:00:00Z\",\"catalogVersion\":1}";

    @Test public void freshPreAndPostGrantsThenMedia403DoesNotDisableUnrelatedVideos() throws Exception {
        AtomicLong now=new AtomicLong(10000);
        try(MockWebServer server=new MockWebServer()){
            server.enqueue(new MockResponse().setBody(GRANTS)); // pre-extraction authority
            server.enqueue(new MockResponse().setBody(GRANTS)); // post-extraction authority
            server.enqueue(new MockResponse().setResponseCode(403).setBody("forbidden source"));
            server.enqueue(new MockResponse().setResponseCode(200).setBody("alternative media"));
            server.start();
            NativeApi api=new NativeApi(new ExtractorDownloader(false),
                    server.url("/?action=list&format=native").toString(),now::get);
            assertTrue(api.whitelist(true,false).contains("AAAAAAAAAAA"));
            // Sources are modeled: a real NewPipe extractor is not invoked by this
            // isolated media-response regression.
            NativeApi.Playback extracted=new NativeApi.Playback("AAAAAAAAAAA","tested",List.of(
                    new NativeApi.Source("https://r1.googlevideo.com/v720",null,720,2100000),
                    new NativeApi.Source("https://r2.googlevideo.com/v360",null,360,700000)));
            assertEquals(2,extracted.sources.size());
            assertTrue(api.whitelist(true,false).contains("AAAAAAAAAAA"));
            OkHttpClient transport=new OkHttpClient();
            try(Response denied=transport.newCall(new Request.Builder()
                    .url(server.url("/media720")).build()).execute()){
                assertEquals(403,denied.code());
                MediaHttpFailure failure=null;
                try{MediaHttpFailure.rejectUnsupportedMediaStatus(denied.code(),"video");fail();}
                catch(MediaHttpFailure expected){failure=expected;}
                assertNotNull(failure);
                assertEquals("video",failure.track);
                assertEquals(403,failure.status);
                assertEquals("MEDIA_SOURCE_UNAVAILABLE",NativeApi.errorCode(new IOException("Media3",failure)));
                assertTrue(MediaHttpFailure.canSwitch(failure.status,0,1,extracted.sources.size()));
                assertFalse(MediaHttpFailure.canSwitch(failure.status,1,1,extracted.sources.size()));
                api.recordFailure(failure); // defensive: must never start any global cooldown
                assertEquals(0,api.cooldownRemainingMs());
            }
            try(Response alternative=transport.newCall(new Request.Builder()
                    .url(server.url("/media360")).build()).execute()){
                assertEquals(200,alternative.code());
                MediaHttpFailure.rejectUnsupportedMediaStatus(alternative.code(),"video");
            }
            assertEquals(4,server.getRequestCount());
            api.checkNetwork(); // other videos and channel metadata remain eligible
        }
    }

    @Test public void audioAndVideoFailuresRetainDistinctRoleAndHttpStatus() throws Exception {
        for(int status:new int[]{401,403,429}){
            for(String role:new String[]{"video","audio"}){
                try{MediaHttpFailure.rejectUnsupportedMediaStatus(status,role);fail();}
                catch(MediaHttpFailure failure){
                    assertEquals(status,failure.status);
                    assertEquals(role,failure.track);
                    assertSame(failure,MediaHttpFailure.find(new IOException("wrapped",failure)));
                    assertEquals(status==429?"MEDIA_SOURCE_RATE_LIMITED":"MEDIA_SOURCE_UNAVAILABLE",
                            MediaHttpFailure.category(status));
                    assertFalse(MediaHttpFailure.canSwitch(429,0,1,2));
                }
            }
        }
        assertNull(MediaHttpFailure.find(new IOException("UPSTREAM_BLOCKED")));
        assertFalse(MediaHttpFailure.canSwitch(403,0,6,9));
        assertFalse(MediaHttpFailure.canSwitch(403,1,2,9));
    }

    @Test public void realNewPipeBlockAndRateLimitRemainProtectedButNeverFifteenMinutes(){
        AtomicLong now=new AtomicLong(1000);
        UpstreamCooldown block=new UpstreamCooldown(now::get);
        IOException upstream=new IOException("UPSTREAM_BLOCKED");
        block.record(upstream,"UPSTREAM_BLOCKED");
        assertEquals(60000,block.remainingMs());
        now.addAndGet(61000);
        assertEquals(0,block.remainingMs());
        UpstreamCooldown rate=new UpstreamCooldown(now::get);
        rate.record(new IOException("RATE_LIMITED"),"RATE_LIMITED");
        assertEquals(120000,rate.remainingMs());
        rate.record(new IOException("MEDIA_HTTP_403"),"MEDIA_SOURCE_UNAVAILABLE");
        assertEquals(120000,rate.remainingMs());
    }
}
