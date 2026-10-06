// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.TimeUnit;
import okhttp3.*;
import org.json.*;
final class GithubListStore {
    static final String REPO_PATH="/repos/yt2178/kids-youtube";
    private final OkHttpClient client;
    private final HttpUrl base;
    private final String token;
    static final class Failure extends IOException {
        final int status;
        Failure(int status){super("GITHUB_"+status);this.status=status;}
    }
    static final class Snapshot {
        final String text,sha;
        Snapshot(String text,String sha){this.text=text;this.sha=sha;}
    }
    GithubListStore(String token) {
        this(token,new OkHttpClient.Builder().connectTimeout(5,TimeUnit.SECONDS)
                .readTimeout(8,TimeUnit.SECONDS).callTimeout(10,TimeUnit.SECONDS)
                .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build(),
                HttpUrl.get("https://api.github.com"));
    }
    // Package-private injection is used only by local MockWebServer tests.
    GithubListStore(String token,OkHttpClient client,HttpUrl base){this.token=token;this.client=client;this.base=base;}
    private JSONObject request(String method,String path,JSONObject data) throws Exception {
        if(token==null || token.isEmpty())throw new Failure(401);
        RequestScope scope=RequestScope.CURRENT.get();if(scope!=null)scope.check();
        RequestBody body=data==null?null:RequestBody.create(data.toString(),MediaType.get("application/json; charset=utf-8"));
        okhttp3.Request req=new okhttp3.Request.Builder().url(base.resolve(path))
                .header("Authorization","Bearer "+token).header("Accept","application/vnd.github+json")
                .header("X-GitHub-Api-Version","2022-11-28").header("Cache-Control","no-cache")
                .header("User-Agent","Kids-YouTube-Parent").method(method,body).build();
        Call call=client.newCall(req);
        if(scope!=null){scope.add(call);call.timeout().timeout(Math.max(1,scope.deadline-System.currentTimeMillis()),TimeUnit.MILLISECONDS);}
        try(okhttp3.Response response=call.execute()) {
            if(!response.isSuccessful())throw new Failure(response.code());
            String text=ExtractorDownloader.readBounded(response.body(),2*1024*1024);
            return new JSONObject(text);
        }finally{if(scope!=null)scope.remove(call);}
    }
    void validateConnection() throws Exception {
        JSONObject repo=request("GET",REPO_PATH,null);
        if(repo.optJSONObject("permissions")==null || !repo.optJSONObject("permissions").optBoolean("push"))throw new Failure(403);
        read();
    }
    Snapshot read() throws Exception {
        JSONObject json=request("GET",REPO_PATH+"/contents/videos.txt?ref=main",null);
        if(!"base64".equals(json.optString("encoding")) || json.optInt("size")>1000000)
            throw new IOException("INVALID_LIST");
        String sha=json.getString("sha");
        if(!sha.matches("[0-9a-f]{40}"))throw new IOException("INVALID_SHA");
        String text=new String(Base64.getMimeDecoder().decode(json.getString("content")),StandardCharsets.UTF_8);
        ListEditor.entries(text);
        return new Snapshot(text,sha);
    }
    private void write(Snapshot before,String text,String message) throws Exception {
        request("PUT",REPO_PATH+"/contents/videos.txt",new JSONObject()
            .put("branch","main").put("sha",before.sha).put("message",message)
            .put("content",Base64.getEncoder().encodeToString(text.getBytes(StandardCharsets.UTF_8))));
    }
    boolean add(String canonical,String original,String title,String note) throws Exception {
        for(int attempt=0;attempt<3;attempt++) {
            Snapshot before=read();
            String text=ListEditor.add(before.text,canonical,original,title,note);
            if(text.equals(before.text))return false;
            try{write(before,text,"Approve "+(ApprovalPolicy.classify(canonical).videoId==null?"channel":"video")+" from parent app");return true;}
            catch(Failure e){if(e.status!=409 || attempt==2)throw e;}
            catch(IOException e){
                // A lost PUT response is ambiguous: verify the current file instead
                // of telling the parent to approve again or duplicating their change.
                if(ListEditor.contains(read().text,canonical,original))return true;
                throw e;
            }
        }
        throw new IOException("CONFLICT");
    }
    void remove(String canonical) throws Exception {
        for(int attempt=0;attempt<3;attempt++) {
            Snapshot before=read();String text=ListEditor.remove(before.text,canonical);
            if(text.equals(before.text))return;
            try{write(before,text,"Revoke approval from parent app");return;}
            catch(Failure e){if(e.status!=409 || attempt==2)throw e;}
            catch(IOException e){if(!ListEditor.contains(read().text,canonical,canonical))return;throw e;}
        }
    }
}

