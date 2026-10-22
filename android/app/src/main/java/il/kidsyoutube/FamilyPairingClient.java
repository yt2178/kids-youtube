// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import java.io.IOException;
import java.util.regex.Pattern;
import okhttp3.*;
import org.json.JSONObject;
import org.json.JSONException;

/**
 * Non-integrated transport for a future parent-approved device pairing screen.
 * Credentials are provided for ONE request by an authenticated session owner.
 * Never persists tokens, changes playback authorization or reads legacy data.
 */
final class FamilyPairingClient {
    static final String ORIGIN = "https://jxhelpxhrmwvzrrfrjuh.supabase.co";
    private static final Pattern CODE=Pattern.compile("[A-Za-z0-9_-]{16}");
    private final OkHttpClient http;
    private final HttpUrl endpoint;

    FamilyPairingClient(OkHttpClient http) {
        this(http, ORIGIN + "/functions/v1/kids-youtube-family");
    }
    // Test seam must always point to an explicitly supplied HTTPS URL in production.
    FamilyPairingClient(OkHttpClient http, String endpoint) {
        this.http=http;
        HttpUrl url=HttpUrl.parse(endpoint);
        if(url==null || (!url.isHttps() && !("127.0.0.1".equals(url.host()) || "localhost".equals(url.host()))))
            throw new IllegalArgumentException("Invalid family backend");
        this.endpoint=url;
    }
    static void validate(String code,String name) {
        if(code==null || !CODE.matcher(code.trim()).matches())
            throw new IllegalArgumentException("INVALID_PAIR_CODE");
        if(name==null || name.trim().isEmpty() || name.trim().length()>80)
            throw new IllegalArgumentException("INVALID_DEVICE_NAME");
    }
    boolean pair(String accessToken, String code, String name) throws IOException {
        validate(code,name);
        if(accessToken==null || accessToken.length()<20 || accessToken.length()>4000 ||
                !accessToken.matches("[A-Za-z0-9._-]+"))
            throw new IllegalArgumentException("INVALID_SESSION");
        final String body;
        try {
            body=new JSONObject().put("code",code.trim()).put("name",name.trim()).toString();
        } catch(JSONException e) {throw new IOException("INVALID_BODY",e);}
        HttpUrl url=endpoint.newBuilder().addQueryParameter("action","pair-device").build();
        Request request=new Request.Builder().url(url)
                .post(RequestBody.create(body,MediaType.get("application/json; charset=utf-8")))
                .header("Authorization","Bearer "+accessToken)
                .header("Cache-Control","no-store").build();
        try(Response response=http.newCall(request).execute()) {
            if(!response.isSuccessful())throw new IOException("PAIR_HTTP_"+response.code());
            if(response.body()==null)throw new IOException("PAIR_EMPTY");
            try {
                JSONObject result=new JSONObject(response.body().string());
                if(!result.optBoolean("paired",false))throw new IOException("PAIR_NOT_CONFIRMED");
                return true;
            } catch(JSONException e){throw new IOException("PAIR_BAD_RESPONSE",e);}
        }
    }
}
