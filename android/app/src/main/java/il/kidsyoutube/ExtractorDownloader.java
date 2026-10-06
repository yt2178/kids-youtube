// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import java.io.*;
import java.net.URI;
import java.util.*;
import java.util.concurrent.TimeUnit;
import okhttp3.*;
import org.schabi.newpipe.extractor.downloader.Downloader;
import org.schabi.newpipe.extractor.downloader.Request;
import org.schabi.newpipe.extractor.downloader.Response;
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException;

final class ExtractorDownloader extends Downloader {
    final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(5,TimeUnit.SECONDS).readTimeout(8,TimeUnit.SECONDS)
            .callTimeout(12,TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false)
            .retryOnConnectionFailure(false).build();
    static boolean allowed(String url) {
        try {
            URI u=URI.create(url);String h=u.getHost();
            return "https".equals(u.getScheme()) && u.getRawUserInfo()==null && u.getPort()==-1 && h!=null
                    && (h.equals("youtube.com") || h.endsWith(".youtube.com")
                    || h.equals("googlevideo.com") || h.endsWith(".googlevideo.com")
                    || h.equals("youtubei.googleapis.com"));
        } catch (RuntimeException e) {return false;}
    }
    @Override public Response execute(Request request) throws IOException,ReCaptchaException {
        RequestScope scope=RequestScope.CURRENT.get();
        if(scope!=null)scope.check();
        if(!allowed(request.url()))throw new IOException("INVALID_REQUEST");
        RequestBody body=request.dataToSend()==null ? null : RequestBody.create(request.dataToSend(),null);
        okhttp3.Request.Builder builder=new okhttp3.Request.Builder().url(request.url()).method(request.httpMethod(),body);
        for(Map.Entry<String,List<String>> header:request.headers().entrySet())
            for(String value:header.getValue())builder.addHeader(header.getKey(),value);
        // Use the library's normal headers. No cookies, CAPTCHA solver, PoToken provider,
        // client rotation, or authorization-block bypass is added here.
        Call call=client.newCall(builder.build());
        if(scope!=null){scope.add(call);call.timeout().timeout(Math.max(1,scope.deadline-System.currentTimeMillis()),TimeUnit.MILLISECONDS);}
        try(okhttp3.Response response=call.execute()) {
            if(response.code()==429)throw new IOException("RATE_LIMITED");
            if(response.code()==401 || response.code()==403)throw new IOException("UPSTREAM_BLOCKED");
            if(response.isRedirect())throw new IOException("UPSTREAM_REDIRECT");
            ResponseBody responseBody=response.body();
            String text=readBounded(responseBody,8*1024*1024);
            if(text.toLowerCase(Locale.ROOT).contains("sign in to confirm you’re not a bot")
                    || text.contains("\"status\":\"LOGIN_REQUIRED\"")
                    || text.contains("\"status\": \"LOGIN_REQUIRED\"")
                    || text.contains("g-recaptcha"))throw new IOException("UPSTREAM_BLOCKED");
            return new Response(response.code(),response.message(),response.headers().toMultimap(),
                    text,response.request().url().toString());
        } finally {if(scope!=null)scope.remove(call);}
    }
    static String readBounded(ResponseBody body,int maximum) throws IOException {
        if(body==null)return "";
        if(body.contentLength()>maximum)throw new IOException("RESPONSE_TOO_LARGE");
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();
        try(InputStream input=body.byteStream()){
            byte[] chunk=new byte[8192];int n;
            while((n=input.read(chunk))!=-1){
                if(bytes.size()+n>maximum)throw new IOException("RESPONSE_TOO_LARGE");
                bytes.write(chunk,0,n);
            }
        }
        return bytes.toString(java.nio.charset.StandardCharsets.UTF_8.name());
    }
}
