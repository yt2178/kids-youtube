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
    final OkHttpClient client;
    final OkHttpClient authorizationClient;
    // Keep the optional legacy parent companion source-compatible.
    ExtractorDownloader(){this(false);}
    ExtractorDownloader(boolean debugBuild){this(debugBuild,okhttp3.Dns.SYSTEM);}
    // Test seam: same client configuration, only DNS resolution can be fault-injected.
    ExtractorDownloader(boolean debugBuild,okhttp3.Dns dns) {
        OkHttpClient.Builder builder=new OkHttpClient.Builder().dns(dns)
                .connectTimeout(5,TimeUnit.SECONDS).readTimeout(8,TimeUnit.SECONDS)
                .callTimeout(12,TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false)
                .retryOnConnectionFailure(false);
        if(debugBuild)builder.eventListenerFactory(call -> new NetworkTrace(call));
        client=builder.build();
        // Give grant responses their own budget without multiplying extractor retries.
        authorizationClient=client.newBuilder()
                .connectTimeout(8,TimeUnit.SECONDS).readTimeout(14,TimeUnit.SECONDS)
                .callTimeout(32,TimeUnit.SECONDS).build();
    }
    // No hostname, IP, URL, cookies, credentials, or signed media URI is logged.
    private static final class NetworkTrace extends okhttp3.EventListener {
        private static final java.util.concurrent.atomic.AtomicLong NEXT=
                new java.util.concurrent.atomic.AtomicLong();
        private final long id=NEXT.incrementAndGet();
        private final long started=android.os.SystemClock.elapsedRealtime();
        private final String kind;
        private final String trace;
        NetworkTrace(Call call){
            String tag=call.request().tag(String.class);
            kind="authorization".equals(tag)?"authorization":
                "catalog".equals(tag)?"catalog":"extractor";
            // OkHttp's event listener is constructed when newCall() runs on
            // the worker, so it can inherit the same verified bridge scope.
            RequestScope scope=RequestScope.CURRENT.get();
            trace=scope==null?" bridgeId=- loadCycle=0 jsRequestId=0":scope.trace();
        }
        private void mark(String phase){
            android.util.Log.d("KidsNetwork","id="+id+" kind="+kind+trace+" phase="+phase+
                    " elapsedMs="+(android.os.SystemClock.elapsedRealtime()-started));
        }
        @Override public void callStart(Call call){mark("call-start");}
        @Override public void dnsStart(Call call,String name){mark("dns-start");}
        @Override public void dnsEnd(Call call,String name,List<java.net.InetAddress> addresses){mark("dns-end");}
        @Override public void connectStart(Call call,java.net.InetSocketAddress address,java.net.Proxy proxy){mark("tcp-start");}
        @Override public void connectEnd(Call call,java.net.InetSocketAddress address,java.net.Proxy proxy,okhttp3.Protocol protocol){mark("tcp-end");}
        @Override public void secureConnectStart(Call call){mark("tls-start");}
        @Override public void secureConnectEnd(Call call,Handshake handshake){mark("tls-end");}
        @Override public void responseHeadersEnd(Call call,okhttp3.Response response){mark("headers-"+response.code());}
        @Override public void responseBodyEnd(Call call,long byteCount){mark("body-end");}
        @Override public void callEnd(Call call){mark("call-end");}
        @Override public void callFailed(Call call,IOException error){mark("failed-"+error.getClass().getSimpleName());}
    }
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
        okhttp3.Request.Builder builder=new okhttp3.Request.Builder().url(request.url())
                .tag(String.class,"extractor").method(request.httpMethod(),body);
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
