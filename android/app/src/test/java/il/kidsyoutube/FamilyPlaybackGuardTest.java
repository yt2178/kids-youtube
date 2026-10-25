package il.kidsyoutube;
import org.junit.Test;
import org.json.JSONObject;
import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.MockResponse;
import java.io.IOException;
import static org.junit.Assert.*;
public final class FamilyPlaybackGuardTest {
 private static final String TOKEN="abcdefghijklmnopqrstuvwxyz1234567890";
 private static FamilyAuthClient client(MockWebServer mock){
  return new FamilyAuthClient(new OkHttpClient(),mock.url("/").toString());
 }
 @Test public void approvedVideoRequiresTwoFreshMatchingResponses() throws Exception {
  try(MockWebServer server=new MockWebServer()){
   server.enqueue(new MockResponse().setBody("{\"contract\":1,\"version\":4,\"list\":\"https://www.youtube.com/watch?v=abcdefghijk\"}"));
   server.enqueue(new MockResponse().setBody("{\"contract\":1,\"version\":4,\"videos\":[\"abcdefghijk\"]}"));
   new FamilyPlaybackGuard(client(server)).authorizeVideo(TOKEN,"abcdefghijk");
   assertEquals("/functions/v1/kids-youtube-family?action=playback-grants",server.takeRequest().getPath());
   assertEquals("/functions/v1/kids-youtube-family?action=catalog-ids",server.takeRequest().getPath());
  }
 }
 @Test public void unapprovedVideoMustFailClosed() throws Exception {
  try(MockWebServer server=new MockWebServer()){
   server.enqueue(new MockResponse().setBody("{\"contract\":1,\"version\":4,\"list\":\"https://www.youtube.com/watch?v=abcdefghijk\"}"));
   server.enqueue(new MockResponse().setBody("{\"contract\":1,\"version\":4,\"videos\":[\"abcdefghijk\"]}"));
   try{new FamilyPlaybackGuard(client(server)).authorizeVideo(TOKEN,"ABCDEFGHIJK");fail("allowed unauthorized video");}
   catch(IOException ex){assertEquals("FAMILY_NOT_APPROVED",ex.getMessage());}
  }
 }
 @Test public void revokedDeviceDenialDoesNotFallback() throws Exception {
  try(MockWebServer server=new MockWebServer()){
   server.enqueue(new MockResponse().setResponseCode(403).setBody("{\"error\":\"NO_FAMILY\"}"));
   try{new FamilyPlaybackGuard(client(server)).authorizeVideo(TOKEN,"abcdefghijk");fail("allowed revoked device");}
   catch(IOException ex){assertEquals("FAMILY_GRANTS_HTTP_403",ex.getMessage());}
   assertEquals(1,server.getRequestCount());
  }
 }
 @Test public void versionMismatchNeverApprovesVideo() throws Exception {
  try(MockWebServer server=new MockWebServer()){
   server.enqueue(new MockResponse().setBody("{\"contract\":1,\"version\":4,\"list\":\"https://www.youtube.com/watch?v=abcdefghijk\"}"));
   server.enqueue(new MockResponse().setBody("{\"contract\":1,\"version\":5,\"videos\":[\"abcdefghijk\"]}"));
   try{new FamilyPlaybackGuard(client(server)).authorizeVideo(TOKEN,"abcdefghijk");fail("allowed stale catalog");}
   catch(IOException ex){assertEquals("FAMILY_CATALOG_VERSION_CHANGED",ex.getMessage());}
  }
 }
}
