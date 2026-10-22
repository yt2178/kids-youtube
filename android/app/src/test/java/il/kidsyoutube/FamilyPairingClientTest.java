// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.IOException;
import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;

public final class FamilyPairingClientTest {
 @Test public void rejectsMalformedCodeAndNoNetworkContact() throws Exception {
  try(MockWebServer server=new MockWebServer()) {
   FamilyPairingClient client=new FamilyPairingClient(new OkHttpClient(),server.url("/functions/v1/kids-youtube-family").toString());
   for(String invalid:new String[]{"","123","abc/def","abcdefghijklmnopq"}) {
    try{client.pair("abcdefghijklmnopqrstuv",invalid,"מכשיר הילד");fail("accepted invalid code");}
    catch(IllegalArgumentException expected){}
   }
   assertEquals(0,server.getRequestCount());
  }
 }
 @Test public void sendsOnlyCodeAndDeviceNameAndRequiresConfirmation() throws Exception {
  try(MockWebServer server=new MockWebServer()) {
   server.enqueue(new MockResponse().setResponseCode(200).setBody("{\"paired\":true}"));
   FamilyPairingClient client=new FamilyPairingClient(new OkHttpClient(),server.url("/functions/v1/kids-youtube-family").toString());
   assertTrue(client.pair("abcdefghijklmnopqrstuv","abcdefghijklmnop","מכשיר"));
   RecordedRequest request=server.takeRequest();
   assertEquals("POST",request.getMethod());
   assertEquals("/functions/v1/kids-youtube-family?action=pair-device",request.getPath());
   assertEquals("Bearer abcdefghijklmnopqrstuv",request.getHeader("Authorization"));
   String body=request.getBody().readUtf8();
   assertTrue(body.contains("\"code\":\"abcdefghijklmnop\""));
   assertFalse(body.contains("familyId"));
   assertFalse(body.contains("expectedVersion"));
  }
 }
 @Test public void rejectsSuccessStatusWithoutProof() throws Exception {
  try(MockWebServer server=new MockWebServer()) {
   server.enqueue(new MockResponse().setResponseCode(200).setBody("{\"paired\":false}"));
   FamilyPairingClient client=new FamilyPairingClient(new OkHttpClient(),server.url("/").toString());
   try{client.pair("abcdefghijklmnopqrstuv","abcdefghijklmnop","Device");fail("missing paired confirmation");}
   catch(IOException expected){assertEquals("PAIR_NOT_CONFIRMED",expected.getMessage());}
  }
 }
}
