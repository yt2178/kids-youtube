package il.kidsyoutube;
import org.junit.Test;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.IOException;
import static org.junit.Assert.*;

public final class FamilyVideoCatalogTest {
 @Test public void acceptsMatchingVersionAndExactExplicitIds() throws Exception {
  FamilyApprovalSnapshot grants=FamilyApprovalSnapshot.fromDevicePlaybackGrants(
    new JSONObject().put("contract",1).put("version",4)
      .put("list","https://www.youtube.com/watch?v=abcdefghijk"));
  FamilyVideoCatalog catalog=FamilyVideoCatalog.fromServer(
    new JSONObject().put("contract",1).put("version",4)
      .put("videos",new JSONArray().put("abcdefghijk")));
  catalog.assertMatches(grants);
  assertEquals(1,catalog.videoIds.size());
 }
 @Test public void emptyFamilyHasNoLegacyFallback() throws Exception {
  FamilyApprovalSnapshot grants=FamilyApprovalSnapshot.fromDevicePlaybackGrants(
    new JSONObject().put("contract",1).put("version",1).put("list",""));
  FamilyVideoCatalog catalog=FamilyVideoCatalog.fromServer(
    new JSONObject().put("contract",1).put("version",1).put("videos",new JSONArray()));
  catalog.assertMatches(grants);
  assertTrue(catalog.videoIds.isEmpty());
 }
 @Test public void deniesMismatchedVersionOrInjectedVideo() throws Exception {
  FamilyApprovalSnapshot grants=FamilyApprovalSnapshot.fromDevicePlaybackGrants(
    new JSONObject().put("contract",1).put("version",1)
      .put("list","https://www.youtube.com/watch?v=abcdefghijk"));
  for(JSONObject data:new JSONObject[]{
    new JSONObject().put("contract",1).put("version",2)
      .put("videos",new JSONArray().put("abcdefghijk")),
    new JSONObject().put("contract",1).put("version",1)
      .put("videos",new JSONArray().put("ABCDEFGHIJK"))
  }){
   try{FamilyVideoCatalog.fromServer(data).assertMatches(grants);fail("Mismatch accepted");}
   catch(IOException expected){}
  }
 }
 @Test public void malformedIdsNeverProduceViewableVideo() throws Exception {
  for(JSONObject data:new JSONObject[]{
    new JSONObject().put("contract",1).put("version",1)
      .put("videos",new JSONArray().put("not_a_valid_id_123")),
    new JSONObject().put("contract",1).put("version",1)
      .put("videos",new JSONArray().put("abcdefghijk").put("abcdefghijk")),
    new JSONObject().put("contract",2).put("version",1)
      .put("videos",new JSONArray())
  }){
   try{FamilyVideoCatalog.fromServer(data);fail("Invalid catalog accepted");}
   catch(IOException expected){}
  }
 }
}
