package il.kidsyoutube;
import org.junit.Test;
import org.json.JSONObject;
import java.io.IOException;
import static org.junit.Assert.*;

public final class FamilyApprovalSnapshotTest {
 @Test public void parsesFamilyGrantsWithoutAcceptingLegacyCatalogFields() throws Exception {
  JSONObject raw=new JSONObject().put("list","https://www.youtube.com/watch?v=abcdefghijk")
   .put("version",7);
  FamilyApprovalSnapshot result=FamilyApprovalSnapshot.fromAuthorizedResponse(raw);
  assertEquals(7,result.version);
  assertTrue(result.policy.videos.contains("abcdefghijk"));
  assertFalse(result.policy.videos.contains("ABCDEFGHIJK"));
 }
 @Test public void rejectsMissingOrMalformedServerGrant() throws Exception {
  JSONObject[] invalid={new JSONObject(),new JSONObject().put("version",1),
   new JSONObject().put("list",""),new JSONObject().put("version","1").put("list",""),
   new JSONObject().put("version",0).put("list","")};
  for(JSONObject data:invalid){
   try{FamilyApprovalSnapshot.fromAuthorizedResponse(data);fail("accepted malformed grant");}
   catch(IOException expected){}
  }
 }
 @Test public void emptyFamilyIsNotLegacyFamily() throws Exception {
  FamilyApprovalSnapshot snap=FamilyApprovalSnapshot.fromAuthorizedResponse(
    new JSONObject().put("list","").put("version",1));
  assertTrue(snap.policy.videos.isEmpty());
  assertTrue(snap.policy.channels.isEmpty());
  assertTrue(snap.policy.channelUrls.isEmpty());
 }
}
