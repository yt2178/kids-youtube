// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import java.io.IOException;
import okhttp3.*;
import org.json.JSONObject;
import org.json.JSONException;

/** Supabase Auth REST transport for a separately activated Android family pilot. */
final class FamilyAuthClient {
    static final String HOST="https://jxhelpxhrmwvzrrfrjuh.supabase.co";
    static final String PUBLISHABLE="sb_publishable_DBqKHRzGSVN0YvvXVS6w4g_-dv416mu";
    static final class Session {
        final String accessToken,refreshToken;
        Session(String access,String refresh){accessToken=access;refreshToken=refresh;}
    }
    private final OkHttpClient http;
    private final HttpUrl base;
    FamilyAuthClient(OkHttpClient http){this(http,HOST);}
    FamilyAuthClient(OkHttpClient http,String root){
        this.http=http;
        HttpUrl parsed=HttpUrl.parse(root);
        if(parsed==null || (!parsed.isHttps()&&!parsed.host().equals("127.0.0.1")
                &&!parsed.host().equals("localhost")))
            throw new IllegalArgumentException("INVALID_AUTH_ENDPOINT");
        base=parsed;
    }
    private JSONObject execute(String path,String grant,JSONObject payload,String authorization) throws IOException {
        HttpUrl.Builder url=base.newBuilder();
        for(String segment:path.split("/"))if(!segment.isEmpty())url.addPathSegment(segment);
        if(grant!=null)url.addQueryParameter("grant_type",grant);
        Request.Builder builder=new Request.Builder().url(url.build())
                .post(RequestBody.create(payload.toString(),MediaType.get("application/json; charset=utf-8")))
                .header("apikey",PUBLISHABLE).header("Cache-Control","no-store");
        if(authorization!=null)builder.header("Authorization","Bearer "+authorization);
        try(Response response=http.newCall(builder.build()).execute()){
            if(!response.isSuccessful())throw new IOException("AUTH_HTTP_"+response.code());
            if(response.body()==null)throw new IOException("AUTH_EMPTY");
            String text=response.body().string();
            if(text.length()>65536)throw new IOException("AUTH_OVERSIZED");
            try{return new JSONObject(text);}catch(JSONException error){throw new IOException("AUTH_INVALID_JSON",error);}
        }
    }
    private Session parse(JSONObject response) throws IOException {
        String access=response.optString("access_token","");
        String refresh=response.optString("refresh_token","");
        if(access.length()<20||access.length()>4000||refresh.length()<20||refresh.length()>4096)
            throw new IOException("AUTH_MISSING_TOKENS");
        return new Session(access,refresh);
    }
    Session createAnonymous() throws IOException {
        // Anonymous login requires provider explicitly enabled in Supabase Auth settings.
        return parse(execute("auth/v1/signup",null,new JSONObject(),null));
    }
    Session refresh(String token) throws IOException {
        if(token==null||token.length()<20||token.length()>4096)
            throw new IOException("AUTH_MISSING_REFRESH");
        JSONObject body=new JSONObject();
        try{body.put("refresh_token",token);}catch(JSONException impossible){throw new IOException("AUTH_INVALID_REFRESH",impossible);}
        return parse(execute("auth/v1/token","refresh_token",body,null));
    }
    JSONObject playbackGrants(String token) throws IOException {
        if(token==null||token.length()<20||token.length()>4000)
            throw new IOException("AUTH_MISSING_ACCESS");
        HttpUrl url=base.newBuilder().addPathSegments("functions/v1/kids-youtube-family")
                .addQueryParameter("action","playback-grants").build();
        Request request=new Request.Builder().url(url).get()
                .header("apikey",PUBLISHABLE).header("Authorization","Bearer "+token)
                .header("Cache-Control","no-store").build();
        try(Response response=http.newCall(request).execute()){
            if(!response.isSuccessful())throw new IOException("FAMILY_GRANTS_HTTP_"+response.code());
            if(response.body()==null)throw new IOException("FAMILY_GRANTS_EMPTY");
            String raw=response.body().string();
            if(raw.length()>1100000)throw new IOException("FAMILY_GRANTS_OVERSIZED");
            try{return new JSONObject(raw);}
            catch(JSONException e){throw new IOException("FAMILY_GRANTS_INVALID_JSON",e);}
        }
    }
    JSONObject list(String token) throws IOException {
        if(token==null||token.length()<20||token.length()>4000)throw new IOException("AUTH_MISSING_ACCESS");
        HttpUrl url=base.newBuilder().addPathSegments("functions/v1/kids-youtube-family")
                .addQueryParameter("action","list").build();
        Request request=new Request.Builder().url(url).get()
                .header("apikey",PUBLISHABLE)
                .header("Authorization","Bearer "+token)
                .header("Cache-Control","no-store").build();
        try(Response response=http.newCall(request).execute()){
            if(!response.isSuccessful())throw new IOException("FAMILY_HTTP_"+response.code());
            if(response.body()==null)throw new IOException("FAMILY_EMPTY");
            String text=response.body().string();
            if(text.length()>1100000)throw new IOException("FAMILY_OVERSIZED");
            try{return new JSONObject(text);}catch(JSONException e){throw new IOException("FAMILY_BAD_RESPONSE",e);}
        }
    }
}
