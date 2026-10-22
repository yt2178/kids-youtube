// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import okhttp3.*;
import okhttp3.mockwebserver.*;
import org.junit.Test;
import static org.junit.Assert.*;

public final class MediaSourceFailuresTest {
    private static final String V1="https://r1.googlevideo.com/v1";
    private static final String V2="https://r1.googlevideo.com/v2";
    private static final String A="https://r1.googlevideo.com/audio";
    private static NativeApi.Source source(String video,String audio){
        return new NativeApi.Source(video,audio,240,300000);
    }
    // Exercise the production media interceptor. Only the terminal test transport is
    // replaced with MockWebServer HTTP; this is NOT a TLS or real Media3 playback test.
    private static Response get(MockWebServer server,MediaSourceFailures failures,
            String url,String role) throws IOException {
        OkHttpClient wire=new OkHttpClient();
        OkHttpClient media=MainActivity.mediaClient(new OkHttpClient(),role,1,1,
                new AtomicInteger(),false,failures).newBuilder().addInterceptor(chain->{
                    Response response=wire.newCall(chain.request().newBuilder()
                            .url(server.url(chain.request().url().encodedPath())).build()).execute();
                    return response.newBuilder().request(chain.request()).build();
                }).build();
        return media.newCall(new Request.Builder().url(url).build()).execute();
    }
    private static MediaHttpFailure denied(MockWebServer server,MediaSourceFailures failures,
            String url,String role,int status) throws Exception {
        server.enqueue(new MockResponse().setResponseCode(status));
        try(Response ignored=get(server,failures,url,role)){fail("expected rejection");}
        catch(MediaHttpFailure error){assertEquals(status,error.status);return error;}
        throw new AssertionError();
    }
    @Test public void bothTracksFailButVideoErrorWinsSkipsEverySharedAudioCandidate() throws Exception {
        try(MockWebServer server=new MockWebServer()){
            server.start();MediaSourceFailures failures=new MediaSourceFailures();
            MediaHttpFailure video=denied(server,failures,V1,"video",403);
            denied(server,failures,A,"audio",403);
            assertEquals("video",video.track); // The error chosen by Media3 in the device log.
            List<NativeApi.Source> sources=List.of(source(V1,A),source(V2,A),source(V2,null));
            int next=failures.nextEligible(sources,List.of(0,1,2),1);
            assertEquals(2,next);
            assertTrue(MediaHttpFailure.canSwitch(video.status,0,next,sources.size()));
            server.enqueue(new MockResponse().setBody("independent combined stream"));
            try(Response ok=get(server,failures,sources.get(next).video,"video")){assertEquals(200,ok.code());}
            assertEquals(3,server.getRequestCount()); // No second request for rejected audio.
        }
    }
    @Test public void onlyVideoDeniedCanUseDifferentVideoWithWorkingAudio() throws Exception {
        try(MockWebServer server=new MockWebServer()){
            server.start();MediaSourceFailures failures=new MediaSourceFailures();
            denied(server,failures,V1,"video",403);
            assertTrue(failures.accepts(V2,A));
            server.enqueue(new MockResponse().setBody("video"));
            server.enqueue(new MockResponse().setBody("audio"));
            try(Response v=get(server,failures,V2,"video");Response a=get(server,failures,A,"audio")){
                assertEquals(200,v.code());assertEquals(200,a.code());
            }
            assertEquals(3,server.getRequestCount());
        }
    }
    @Test public void allCandidatesShareRejectedAudioStopsWithoutMoreHttp() throws Exception {
        try(MockWebServer server=new MockWebServer()){
            server.start();MediaSourceFailures failures=new MediaSourceFailures();
            denied(server,failures,A,"audio",403);
            List<NativeApi.Source> sources=List.of(source(V1,A),source(V2,A));
            int next=failures.nextEligible(sources,List.of(0,1),1);
            assertEquals(2,next);
            assertFalse(MediaHttpFailure.canSwitch(403,0,next,sources.size()));
            assertEquals(1,server.getRequestCount());
        }
    }
    @Test public void independentAlternativeAlsoDeniedDoesNotEnableThirdAttempt() throws Exception {
        try(MockWebServer server=new MockWebServer()){
            server.start();MediaSourceFailures failures=new MediaSourceFailures();
            denied(server,failures,V1,"video",403);
            assertTrue(MediaHttpFailure.canSwitch(403,0,1,3));
            denied(server,failures,V2,"video",403);
            assertFalse(MediaHttpFailure.canSwitch(403,1,2,3));
            assertEquals(2,server.getRequestCount());
        }
    }
    @Test public void rejectionIsExactAndPlaybackLocalAnd429CannotBeHiddenByVideo403(){
        MediaSourceFailures old=new MediaSourceFailures(),fresh=new MediaSourceFailures();
        old.record(A+"?sig=old",403);
        assertFalse(old.accepts(V2,A+"?sig=old"));
        assertTrue(old.accepts(V2,A+"?sig=new"));
        assertTrue(fresh.accepts(V2,A+"?sig=old"));
        old.record(A,429);old.record(V1,403);
        assertTrue(old.rateLimited());assertFalse(fresh.rateLimited());
        fresh.record(V1,500);assertTrue(fresh.accepts(V1,A));
    }
    @Test public void traceReportsActualHeadersAndNeverTheirSensitiveValues() throws Exception {
        try(MockWebServer server=new MockWebServer()){
            server.enqueue(new MockResponse().setBody("ok"));server.start();
            AtomicReference<String> trace=new AtomicReference<>();
            OkHttpClient client=new OkHttpClient.Builder().eventListener(new EventListener(){
                @Override public void requestHeadersEnd(Call call,Request request){
                    trace.set(MediaRequestTrace.safeRequestDetails(request,100));
                }
            }).build();
            Request request=new Request.Builder().url(server.url("/secret-path?expire=200&sig=SECRET&pot=TOKEN&c=VISIONOS&n=PRIVATE"))
                    .header("Cookie","COOKIE").header("Authorization","BEARER").build();
            assertNull(request.header("User-Agent"));
            try(Response response=client.newCall(request).execute()){assertEquals(200,response.code());}
            assertNotNull(server.takeRequest().getHeader("User-Agent"));
            assertTrue(trace.get().contains("userAgent=true"));
            assertTrue(trace.get().contains("expireInSec=100"));
            assertTrue(trace.get().contains("hasPoToken=true"));
            assertTrue(trace.get().contains("visionOsClient=true"));
            for(String secret:List.of("SECRET","TOKEN","PRIVATE","COOKIE","BEARER","secret-path","127.0.0.1"))
                assertFalse(trace.get().contains(secret));
        }
    }
}
