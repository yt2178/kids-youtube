// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import org.junit.Test;
import static org.junit.Assert.*;
import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.RecordedRequest;
import java.io.IOException;

public final class FamilyAuthClientTest {
 private static final String ACCESS="abcdefghijklmnopqrstuvwxyz1234567890";
 private static final String REFRESH="zyxwvutsrqponmlkjihgfedcba0987654321";
 @Test public void anonymousSignupUsesNoParentEmailOrPassword() throws Exception {
  try(MockWebServer server=new MockWebServer()){
   server.enqueue(new MockResponse().setResponseCode(200).setBody("{\"access_token\":\""+ACCESS+"\",\"refresh_token\":\""+REFRESH+"\"}"));
   FamilyAuthClient client=new FamilyAuthClient(new OkHttpClient(),server.url("/").toString());
   FamilyAuthClient.Session session=client.createAnonymous();
   assertEquals(ACCESS,session.accessToken);
   assertEquals(REFRESH,session.refreshToken);
   RecordedRequest req=server.takeRequest();
   assertEquals("POST",req.getMethod());assertEquals("/auth/v1/signup",req.getPath());
   assertEquals("{}",req.getBody().readUtf8());
   assertNotNull(req.getHeader("apikey"));
   assertNull(req.getHeader("Authorization"));
  }
 }
 @Test public void refreshUsesSeparateRotatingCredentials() throws Exception {
  try(MockWebServer server=new MockWebServer()){
   server.enqueue(new MockResponse().setBody("{\"access_token\":\""+ACCESS+"\",\"refresh_token\":\""+REFRESH+"\"}"));
   FamilyAuthClient client=new FamilyAuthClient(new OkHttpClient(),server.url("/").toString());
   assertEquals(REFRESH,client.refresh("an-existing-refresh-token").refreshToken);
   RecordedRequest req=server.takeRequest();
   assertEquals("/auth/v1/token?grant_type=refresh_token",req.getPath());
   assertTrue(req.getBody().readUtf8().contains("an-existing-refresh-token"));
  }
 }
 @Test public void familyListUsesOnlyAuthenticatedIdentity() throws Exception {
  try(MockWebServer server=new MockWebServer()){
   server.enqueue(new MockResponse().setBody("{\"list\":\"\",\"version\":1}"));
   FamilyAuthClient client=new FamilyAuthClient(new OkHttpClient(),server.url("/").toString());
   assertEquals(1,client.list(ACCESS).getInt("version"));
   RecordedRequest req=server.takeRequest();
   assertEquals("/functions/v1/kids-youtube-family?action=list",req.getPath());
   assertEquals("Bearer "+ACCESS,req.getHeader("Authorization"));
   assertEquals("no-store",req.getHeader("Cache-Control"));
  }
 }
 @Test public void malformedResponseFailsClosed() throws Exception {
  try(MockWebServer server=new MockWebServer()){
   server.enqueue(new MockResponse().setResponseCode(200).setBody("{\"access_token\":\"short\"}"));
   FamilyAuthClient client=new FamilyAuthClient(new OkHttpClient(),server.url("/").toString());
   try{client.createAnonymous();fail("accepted incomplete tokens");}
   catch(IOException error){assertEquals("AUTH_MISSING_TOKENS",error.getMessage());}
  }
 }
}
