// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import android.os.SystemClock;
import okhttp3.*;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Debug-only per-wire-call attribution. Never logs signed URL, host, path,
 * query values, headers, token values, or failure exception messages.
 */
final class MediaRequestTrace extends EventListener {
    private final String role;
    private final long generation;
    private final int source;
    private final int callNumber;
    private final long started=SystemClock.elapsedRealtime();

    MediaRequestTrace(Call call,String role,long generation,int source,AtomicInteger calls){
        this.role=role;
        this.generation=generation;
        this.source=source;
        this.callNumber=calls.incrementAndGet();
        log("start", "");
    }
    // This callback receives the actual request after OkHttp adds its default headers.
    // call.request() in the constructor is earlier and falsely suggested no User-Agent.
    @Override public void requestHeadersEnd(Call call,Request req){
        log("request-headers-sent",safeRequestDetails(req,System.currentTimeMillis()/1000L));
    }
    static String safeRequestDetails(Request req,long nowSeconds){
        HttpUrl url=req.url();
        long expiresIn=-1;
        try{
            String expiry=url.queryParameter("expire");
            if(expiry!=null)expiresIn=Long.parseLong(expiry)-nowSeconds;
        }catch(NumberFormatException ignored){}
        // Timestamp *difference* only, never a signed query value.
        return "method="+("GET".equals(req.method())?"GET":"other")+
                " range="+(req.header("Range")!=null)+
                " userAgent="+(req.header("User-Agent")!=null)+
                " referer="+(req.header("Referer")!=null)+
                " origin="+(req.header("Origin")!=null)+
                " queryKeys="+url.queryParameterNames().size()+
                " expireInSec="+expiresIn+
                " hasPoToken="+url.queryParameterNames().contains("pot")+
                " hasSignature="+(url.queryParameterNames().contains("sig")||url.queryParameterNames().contains("signature"))+
                " hasN="+url.queryParameterNames().contains("n")+
                " visionOsClient="+"VISIONOS".equals(url.queryParameter("c"));
    }
    private void log(String phase,String detail){
        android.util.Log.d("KidsMedia","playback="+generation+" source="+source+
                " call="+callNumber+" track="+role+" phase="+phase+
                " elapsedMs="+(SystemClock.elapsedRealtime()-started)+
                (detail.isEmpty()?"":" "+detail));
    }
    @Override public void responseHeadersEnd(Call call,Response response){
        log("headers","status="+response.code());
    }
    @Override public void callEnd(Call call){log("complete","");}
    @Override public void callFailed(Call call,IOException error){
        log("failed","exception="+error.getClass().getSimpleName());
    }
}
