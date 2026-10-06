package il.kidsyoutube;
import org.junit.*;
import static org.junit.Assert.*;
import java.util.*;
import java.nio.charset.StandardCharsets;
import okhttp3.*;
import okhttp3.mockwebserver.*;
import org.json.*;
public class GithubListStoreTest {
    MockWebServer server;
    GithubListStore store;
    final String video="https://www.youtube.com/watch?v=mVTlbvQ_010",other="https://www.youtube.com/watch?v=AAAAAAAAAAA";
    final String sha="a".repeat(40),newSha="b".repeat(40);
    @Before public void setup() throws Exception {
        server=new MockWebServer();server.start();
        store=new GithubListStore("fake-test-only",new OkHttpClient.Builder()
            .followRedirects(false).retryOnConnectionFailure(false).build(),server.url("/"));
    }
    @After public void cleanup() throws Exception {server.shutdown();}
    void list(String text,String hash)throws Exception{
        server.enqueue(new MockResponse().setBody(new JSONObject().put("sha",hash).put("encoding","base64")
            .put("size",text.getBytes(StandardCharsets.UTF_8).length)
            .put("content",Base64.getEncoder().encodeToString(text.getBytes(StandardCharsets.UTF_8))).toString()));
    }
    @Test public void additionUsesCurrentShaFixedMainAndOnlyWhitelistPath()throws Exception{
        list(other+"\n",sha);server.enqueue(new MockResponse().setBody("{}"));
        assertTrue(store.add(video,video,"שם","הערה"));
        RecordedRequest read=server.takeRequest(),write=server.takeRequest();
        assertEquals("/repos/yt2178/kids-youtube/contents/videos.txt?ref=main",read.getPath());
        assertEquals("Bearer fake-test-only",read.getHeader("Authorization"));
        JSONObject body=new JSONObject(write.getBody().readUtf8());
        assertEquals(sha,body.getString("sha"));assertEquals("main",body.getString("branch"));
        String updated=new String(Base64.getDecoder().decode(body.getString("content")),StandardCharsets.UTF_8);
        assertTrue(updated.startsWith(other));assertTrue(updated.contains(video));assertEquals("PUT",write.getMethod());
    }
    @Test public void duplicatesDoNotCreateACommit()throws Exception{
        list("https://youtu.be/mVTlbvQ_010 // existing",sha);
        assertFalse(store.add(video,video,"name",""));assertEquals(1,server.getRequestCount());
    }
    @Test public void conflictReReadsAndPreservesAnotherParentsUpdate()throws Exception{
        list("// first\n",sha);server.enqueue(new MockResponse().setResponseCode(409));
        list("// first\n"+other+"\n",newSha);server.enqueue(new MockResponse().setBody("{}"));
        assertTrue(store.add(video,video,"name",""));
        for(int i=0;i<3;i++)server.takeRequest();
        JSONObject finalWrite=new JSONObject(server.takeRequest().getBody().readUtf8());
        assertEquals(newSha,finalWrite.getString("sha"));
        assertTrue(new String(Base64.getDecoder().decode(finalWrite.getString("content")),StandardCharsets.UTF_8).contains(other));
    }
    @Test public void repeatedConflictsAreFinite()throws Exception{
        for(int i=0;i<3;i++){list("",sha);server.enqueue(new MockResponse().setResponseCode(409));}
        assertThrows(GithubListStore.Failure.class,()->store.add(video,video,"name",""));
        assertEquals(6,server.getRequestCount());
    }
    @Test public void unauthorizedWritesNeverReportSuccess()throws Exception{
        list("",sha);server.enqueue(new MockResponse().setResponseCode(403));
        assertThrows(GithubListStore.Failure.class,()->store.add(video,video,"name",""));
        assertEquals(2,server.getRequestCount());
    }
    @Test public void removalWorksFromFreshRemoteFile()throws Exception{
        list(video+"\n"+other,sha);server.enqueue(new MockResponse().setBody("{}"));
        store.remove(video);server.takeRequest();
        JSONObject body=new JSONObject(server.takeRequest().getBody().readUtf8());
        String text=new String(Base64.getDecoder().decode(body.getString("content")),StandardCharsets.UTF_8);
        assertFalse(text.contains("mVTlbvQ_010"));assertTrue(text.contains("AAAAAAAAAAA"));
    }
    @Test public void alreadyRemovedEntryDoesNotCreateACommit()throws Exception{
        list(other,sha);store.remove(video);assertEquals(1,server.getRequestCount());
    }
    @Test public void readRequiresValidRemoteSha()throws Exception{
        list("", "not-a-sha");assertThrows(Exception.class,()->store.read());
    }
    @Test public void connectionRequiresRepositoryWriteAccess()throws Exception{
        server.enqueue(new MockResponse().setBody("{\"permissions\":{\"push\":false}}"));
        assertThrows(GithubListStore.Failure.class,()->store.validateConnection());
    }
    @Test public void redirectsNeverReceiveTheCredential()throws Exception{
        server.enqueue(new MockResponse().setResponseCode(302).addHeader("Location","https://attacker.invalid"));
        assertThrows(GithubListStore.Failure.class,()->store.read());assertEquals(1,server.getRequestCount());
    }
    @Test public void lostPutResponseChecksRemoteInsteadOfRepeatingTheWrite()throws Exception{
        list("",sha);server.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST));
        list(video+"\n",newSha);
        assertTrue(store.add(video,video,"name",""));
        assertEquals("GET",server.takeRequest().getMethod());
        assertEquals("PUT",server.takeRequest().getMethod());
        assertEquals("GET",server.takeRequest().getMethod());assertEquals(3,server.getRequestCount());
    }
    @Test public void unresponsiveServerHasABoundedTimeout()throws Exception{
        server.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE));
        store=new GithubListStore("fake-test-only",new OkHttpClient.Builder()
            .callTimeout(100,java.util.concurrent.TimeUnit.MILLISECONDS).retryOnConnectionFailure(false).build(),server.url("/"));
        long start=System.nanoTime();
        assertThrows(java.io.IOException.class,()->store.read());
        assertTrue(java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-start)<2000);
    }
}
