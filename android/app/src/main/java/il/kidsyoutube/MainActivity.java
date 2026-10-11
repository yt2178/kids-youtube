// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import androidx.webkit.*;
import androidx.media3.common.*;
import androidx.media3.datasource.*;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.upstream.DefaultBandwidthMeter;
import androidx.media3.exoplayer.source.*;
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy;
import androidx.media3.ui.PlayerView;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import okhttp3.OkHttpClient;
import org.json.*;

/** Only packaged main-frame JS is allowed to call the native bridge. */
public final class MainActivity extends Activity {
    static final String ORIGIN="https://appassets.androidplatform.net";
    static final String HOME=ORIGIN+"/assets/index.html";
    private String effectiveSupabaseHost;
    static final String SUPABASE_PATH="/functions/v1/kids-youtube";
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ThreadPoolExecutor workers=new ThreadPoolExecutor(3,3,0,TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(32),new ThreadPoolExecutor.AbortPolicy());
    // A blocked extractor must not exhaust the execution slots for parent
    // authorization. Keep this separate, bounded and cancellable.
    private final ThreadPoolExecutor authorizationWorkers=new ThreadPoolExecutor(2,2,0,TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(8),new ThreadPoolExecutor.AbortPolicy());
    private final ThreadPoolExecutor playbackWorkers=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(2),new ThreadPoolExecutor.AbortPolicy());
    private final Map<String,Task> tasks=new HashMap<>();
    private WebView web;
    private NativeApi api;
    private LinearLayout overlay;
    private TextView title,message;
    private ProgressBar loading;
    private Button retry,quality;
    private String qualityMode="auto";
    private List<Integer> sourceOrder=List.of();
    private long observedBandwidthBps=-1;
    private long playbackStartedAt;
    private DefaultBandwidthMeter bandwidthMeter;
    private androidx.media3.exoplayer.upstream.BandwidthMeter.EventListener bandwidthListener;
    private PlayerView playerView;
    private ExoPlayer player;
    private long mediaOwnerGeneration;
    private Task playTask;
    private long playerGeneration;
    private NativeApi.Playback active;
    private int sourceIndex;
    private long resumeAt;
    private Runnable playerTimeout;
    private boolean destroyed;
    private long startupStartedAt;
    private void debugBridge(String method,String id,String phase,long started,String outcome,RequestScope scope){
        if((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)==0)return;
        android.util.Log.d("KidsCatalog","native-request "+phase+
                " operation="+method+" bridgeId="+id+scope.trace()+
                " elapsedMs="+(android.os.SystemClock.elapsedRealtime()-started)+
                " result="+outcome);
    }
    private void logWebDiagnostic(String message){
        if(message==null || !message.startsWith("KidsCatalog ") || message.length()>1500)return;
        int split=message.indexOf(" {");
        if(split<0)return;
        String event=message.substring(12,split);
        if(!event.matches("[a-z0-9-]{1,48}"))return;
        try{
            JSONObject fields=new JSONObject(message.substring(split+1));
            StringBuilder out=new StringBuilder("event=").append(event);
            for(String key:new String[]{"loadCycle","requestId","serial","version","catalogVersion","ms","timeoutMs","authorizationMs"}){
                if(fields.has(key) && !fields.isNull(key)){
                    Object value=fields.opt(key);
                    if(value instanceof Number && ((Number)value).longValue()>=0)
                        out.append(" ").append(key).append("=").append(((Number)value).longValue());
                }
            }
            for(String key:new String[]{"kind","source","transport","outcome","trigger","reason"}){
                String value=fields.optString(key,"");
                if(value.matches("[A-Za-z0-9_-]{1,48}"))
                    out.append(" ").append(key).append("=").append(value);
            }
            android.util.Log.d("KidsWeb",out.toString());
        }catch(JSONException ignored){}
    }
    private void debugStartup(String stage){
        if((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)==0)return;
        android.util.Log.d("KidsStartup",stage+" elapsedMs="+
                (android.os.SystemClock.elapsedRealtime()-startupStartedAt)+
                " build="+getString(R.string.kids_build_sha));
    }

    private final class Task extends FutureTask<Void> {
        final String id;
        final RequestScope scope;
        boolean optionalApi,backgroundGrant;
        JavaScriptReplyProxy callback;
        Task(String id,RequestScope scope,Callable<Void> action) {super(action);this.id=id;this.scope=scope;}
        void abort(){scope.cancel();cancel(true);}
        @Override protected void done(){handler.post(()->{if(tasks.get(id)==this)tasks.remove(id);});}
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        startupStartedAt=android.os.SystemClock.elapsedRealtime();
        debugStartup("onCreate-start");
        effectiveSupabaseHost=Uri.parse(getString(R.string.kids_backend_url)).getHost();
        api=new NativeApi(this);
        qualityMode=getSharedPreferences("kids_prefs",MODE_PRIVATE).getString("quality","auto");
        bandwidthMeter=DefaultBandwidthMeter.getSingletonInstance(this);
        bandwidthListener=(elapsedMs,bytes,bitrateEstimate)->{
            if(elapsedMs>=250 && bytes>=8192 && bitrateEstimate>0)
                observedBandwidthBps=bitrateEstimate;
        };
        bandwidthMeter.addEventListener(handler,bandwidthListener);
        debugStartup("native-api-created");
        FrameLayout root=new FrameLayout(this);root.setBackgroundColor(Color.rgb(26,26,46));
        if(Build.VERSION.SDK_INT>=30){
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view,insets)->{
                android.graphics.Insets safe=insets.getInsets(WindowInsets.Type.systemBars()
                    |WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());
                view.setPadding(safe.left,safe.top,safe.right,safe.bottom);
                // Native root handles these once; CSS must not pad the same insets again.
                return WindowInsets.CONSUMED;
            });
            root.requestApplyInsets();
        }
        web=new WebView(this);root.addView(web,new FrameLayout.LayoutParams(-1,-1));
        debugStartup("webview-created");
        overlay=new LinearLayout(this);overlay.setOrientation(LinearLayout.VERTICAL);
        overlay.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        overlay.setBackgroundColor(Color.rgb(15,15,29));overlay.setVisibility(View.GONE);
        LinearLayout bar=new LinearLayout(this);bar.setGravity(Gravity.CENTER_VERTICAL);
        Button back=button("← חזרה");back.setOnClickListener(v->closePlayer());
        title=text("");title.setMaxLines(2);title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        bar.setPadding(dp(8),dp(4),dp(8),dp(4));bar.setMinimumHeight(dp(64));
        back.setTextDirection(View.TEXT_DIRECTION_LTR);
        bar.addView(back,new LinearLayout.LayoutParams(dp(116),-2));
        bar.addView(title,new LinearLayout.LayoutParams(0,-2,1));
        overlay.addView(bar,new LinearLayout.LayoutParams(-1,-2));
        loading=new ProgressBar(this);loading.setIndeterminate(true);loading.setVisibility(View.GONE);
        LinearLayout.LayoutParams loadingParams=new LinearLayout.LayoutParams(dp(42),dp(42));loadingParams.gravity=Gravity.CENTER_HORIZONTAL;
        overlay.addView(loading,loadingParams);
        message=text("מתחבר...");message.setGravity(Gravity.CENTER);message.setMinHeight(dp(42));
        overlay.addView(message,new LinearLayout.LayoutParams(-1,-2));
        retry=button("נסו שוב");retry.setVisibility(View.GONE);
        retry.setOnClickListener(v->{if(active!=null)openPlayer(active.id,title.getText().toString());});
        overlay.addView(retry,new LinearLayout.LayoutParams(-1,dp(64)));
        quality=button("איכות: אוטומטי");quality.setTextSize(16);
        quality.setOnClickListener(v->showQualityMenu());
        overlay.addView(quality,new LinearLayout.LayoutParams(-1,dp(48)));
        updateQualityLabel();
        playerView=new PlayerView(this);
        playerView.setShowNextButton(false);playerView.setShowPreviousButton(false);
        playerView.setShowFastForwardButton(true);playerView.setShowRewindButton(true);
        overlay.addView(playerView,new LinearLayout.LayoutParams(-1,0,1));
        root.addView(overlay,new FrameLayout.LayoutParams(-1,-1));
        setContentView(root);
        debugStartup("view-hierarchy-ready");
        setupWeb();
        debugStartup("webview-load-started");
        handleDeepLink(getIntent());
    }
    @Override protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleDeepLink(intent);
    }
    private void handleDeepLink(android.content.Intent intent) {
        Uri data=intent==null?null:intent.getData();
        if(data==null || !getString(R.string.kids_deep_link_scheme).equals(data.getScheme()) || !"video".equals(data.getHost()))return;
        List<String> parts=data.getPathSegments();
        String id=parts.size()==1?parts.get(0):"";
        if(ApprovalPolicy.VIDEO.matcher(id).matches())openPlayer(id,"טוענים את פרטי הסרטון…");
    }
    private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
    private TextView text(String value){TextView v=new TextView(this);v.setTextColor(Color.WHITE);v.setTextSize(20);v.setText(value);v.setPadding(dp(12),dp(8),dp(12),dp(8));return v;}
    private Button button(String value){Button b=new Button(this);b.setText(value);b.setTextSize(20);b.setTextColor(Color.WHITE);b.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(233,69,96)));b.setMinHeight(dp(60));return b;}
    private void showMessage(String value){message.setText(value);message.setVisibility(value.isEmpty()?View.GONE:View.VISIBLE);}
    private void showLoading(boolean value){loading.setVisibility(value?View.VISIBLE:View.GONE);}
    private void setupWeb() {
        WebSettings settings=web.getSettings();
        settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        if((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0){
            WebView.setWebContentsDebuggingEnabled(true);
            web.setWebChromeClient(new android.webkit.WebChromeClient(){
                @Override public boolean onConsoleMessage(android.webkit.ConsoleMessage message){
                    // Emit allowlisted structured diagnostics only, never page source URLs
                    // or arbitrary console output (which can contain signed links).
                    logWebDiagnostic(message.message());
                    return true;
                }
            });
        }
        settings.setTextZoom(Math.round(getResources().getConfiguration().fontScale*100));
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setSupportMultipleWindows(false);
        web.setDownloadListener((a,b,c,d,e)->{});
        WebViewAssetLoader loader=new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/",new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView view,String url){
                if(HOME.equals(url))debugStartup("webview-page-finished");
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request) {
                // No outgoing browser intents, arbitrary URL entry or remote documents.
                return !HOME.equals(request.getUrl().toString());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request) {
                Uri u=request.getUrl();
                if(u.toString().startsWith(ORIGIN+"/assets/")){
                    WebResourceResponse result=loader.shouldInterceptRequest(u);
                    return result==null ? denied() : result;
                }
                String h=u.getHost();
                boolean supabaseApi="https".equals(u.getScheme()) && effectiveSupabaseHost.equals(h)
                        && SUPABASE_PATH.equals(u.getPath()) && !request.isForMainFrame();
                if(supabaseApi)return null;
                boolean image="https".equals(u.getScheme()) && h!=null
                        && (h.equals("img.youtube.com") || h.equals("ytimg.com") || h.endsWith(".ytimg.com")
                        || h.equals("ggpht.com") || h.endsWith(".ggpht.com")
                        || h.equals("googleusercontent.com") || h.endsWith(".googleusercontent.com"));
                return image && !request.isForMainFrame() ? null : denied();
            }
        });
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)){
            web.setVisibility(View.GONE);
            overlay.setVisibility(View.VISIBLE);showMessage("כדי לפתוח את האפליקציה, בקשו מההורה לעדכן את Android System WebView.");
            return;
        }
        WebViewCompat.addWebMessageListener(web,"KidsAndroid",Set.of(ORIGIN),
                (view,message,origin,isMainFrame,reply)->{
                    if(!isMainFrame || !ORIGIN.equals(origin.toString()) || destroyed)return;
                    receive(message.getData(),reply);
                });
        // No addJavascriptInterface: nested/remote frames cannot reach native code.
        web.loadUrl(HOME);
    }
    private static WebResourceResponse denied(){
        return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Collections.emptyMap(),
                new ByteArrayInputStream(new byte[0]));
    }
    private void receive(String input,JavaScriptReplyProxy reply) {
        if(input==null || input.length()>25000)return;
        try {
            JSONObject data=new JSONObject(input);
            String id=data.getString("id"),method=data.getString("method");
            if(!id.matches("[0-9]{1,12}"))return;
            if(method.equals("cancel")) {
                Task task=tasks.remove(id);if(task!=null)task.abort();
                return;
            }
            if(tasks.containsKey(id)){respond(reply,id,null,"INVALID_REQUEST");return;}
            if(method.equals("play")) {
                JSONObject arg=data.optJSONObject("argument");
                String video=arg==null?data.optString("argument",""):arg.optString("id","");
                String videoTitle=arg==null?"":arg.optString("title","");
                if(!ApprovalPolicy.VIDEO.matcher(video).matches()){respond(reply,id,null,"INVALID_REQUEST");return;}
                // The title is display-only. NativeApi independently validates the id.
                openPlayer(video,videoTitle);respond(reply,id,Boolean.TRUE,null);return;
            }
            if(!Set.of("whitelist","authorization","catalog","api","clear").contains(method)){
                respond(reply,id,null,"INVALID_REQUEST");return;
            }
            if(active!=null&&(method.equals("api")||method.equals("authorization")||
                    method.equals("whitelist"))){
                // An explicit playback owns both fresh grant checks. Background
                // checks cannot supersede them; resume a fresh poll on player close.
                respond(reply,id,null,"PLAYBACK_BUSY");return;
            }
            JSONObject traceArg=method.equals("authorization")?data.optJSONObject("argument"):null;
            long jsCycle=traceArg==null?0:traceArg.optLong("loadCycle",0);
            long jsRequestId=traceArg==null?0:traceArg.optLong("requestId",0);
            if(jsCycle<0||jsCycle>1000000000L||jsRequestId<0||jsRequestId>1000000000L){
                respond(reply,id,null,"INVALID_REQUEST");return;
            }
            RequestScope scope=new RequestScope((method.equals("authorization")||method.equals("whitelist"))?34000:14000,id,jsCycle,jsRequestId);
            String argument=data.optString("argument","");
            Task task=new Task(id,scope,()->{
                scope.enter();
                final long started=android.os.SystemClock.elapsedRealtime();
                if((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0)
                    scope.phase("worker-queue-wait",started-scope.queuedAtMs);
                debugBridge(method,id,"start",started,"pending",scope);
                try {
                    Object result;
                    if(method.equals("whitelist"))result=api.displayWhitelist();
                    else if(method.equals("authorization"))result=api.tracedDisplayAuthorization(
                            traceArg==null || "load".equals(traceArg.optString("source","")));
                    else if(method.equals("catalog"))result=api.sharedCatalog(data.optJSONObject("argument"));
                    else if(method.equals("clear")){api.clear();result=Boolean.TRUE;}
                    else result=api.request(argument);
                    scope.check();debugBridge(method,id,"end",started,"ok",scope);
                    respond(reply,id,result,null);
                }catch(Exception e){
                    String reason=scope.cancelled?"CANCELLED":NativeApi.errorCode(e);
                    debugBridge(method,id,"end",started,reason,scope);
                    // Debug type-only diagnostics: exception messages may contain signed media URLs.
                    if((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0)
                        android.util.Log.d("KidsCatalog","native-failure operation="+method+
                            " type="+e.getClass().getSimpleName()+
                            " root="+NativeApi.safeRootClass(e)+" category="+reason);
                    if(!scope.cancelled)respond(reply,id,null,reason);
                }finally{scope.close();}
                return null;
            });
            task.optionalApi=method.equals("api");
            task.backgroundGrant=method.equals("authorization")||method.equals("whitelist");
            task.callback=reply;
            tasks.put(id,task);
            try{
                (method.equals("authorization")||method.equals("whitelist")?
                    authorizationWorkers:workers).execute(task);
            }catch(RejectedExecutionException e){
                tasks.remove(id);task.abort();respond(reply,id,null,"BUSY");
            }
        }catch(JSONException ignored){ /* Malformed bridge input never grants access. */ }
    }
    private void respond(JavaScriptReplyProxy reply,String id,Object result,String error) {
        handler.post(()->{
            if(destroyed)return;
            try {
                JSONObject out=new JSONObject().put("id",id);
                if(error!=null)out.put("error",error);else out.put("data",result==null?JSONObject.NULL:result);
                reply.postMessage(out.toString());
            }catch(JSONException ignored){}
        });
    }
    private void logPlayback(long generation,String stage,Throwable failure){
        if((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)==0)return;
        Throwable root=failure;
        for(int depth=0;root!=null&&root.getCause()!=null&&depth<12;depth++)root=root.getCause();
        // Never log exception messages: HTTP failures can embed signed media URLs.
        String detail=failure==null?"":(" type="+failure.getClass().getSimpleName()+
            " root="+root.getClass().getSimpleName()+
            " category="+NativeApi.errorCode(failure));
        android.util.Log.d("KidsPlayback","request="+generation+" stage="+stage+detail);
    }
    private static String media3State(int state){
        switch(state){
            case Player.STATE_IDLE:return "IDLE";
            case Player.STATE_BUFFERING:return "BUFFERING";
            case Player.STATE_READY:return "READY";
            case Player.STATE_ENDED:return "ENDED";
            default:return "UNKNOWN";
        }
    }
    private void updateQualityLabel(){
        if(quality==null)return;
        quality.setText("איכות: "+("save".equals(qualityMode)?"חיסכון בנתונים":
                qualityMode.startsWith("manual:")?qualityMode.substring(7)+"p":"אוטומטי"));
    }
    private void selectQuality(String next){
        if(next.equals(qualityMode))return;
        long position=player!=null?player.getCurrentPosition():resumeAt;
        qualityMode=next;
        getSharedPreferences("kids_prefs",MODE_PRIVATE).edit().putString("quality",next).apply();
        updateQualityLabel();
        if(active!=null&&!active.sources.isEmpty())
            openPlayer(active.id,title.getText().toString(),Math.max(0,position));
    }
    private void showQualityMenu(){
        PopupMenu menu=new PopupMenu(this,quality);
        menu.getMenu().add(0,1,0,"אוטומטי");
        menu.getMenu().add(0,2,1,"חיסכון בנתונים");
        if(active!=null){
            SortedSet<Integer> resolutions=new TreeSet<>();
            for(NativeApi.Source source:active.sources)if(source.height>0)resolutions.add(source.height);
            int n=2;
            for(int height:resolutions)menu.getMenu().add(0,100+height,++n,height+"p");
        }
        menu.setOnMenuItemClickListener(item->{
            int id=item.getItemId();
            selectQuality(id==1?"auto":id==2?"save":"manual:"+(id-100));
            return true;
        });
        menu.show();
    }
    private void openPlayer(String id,String displayTitle){
        openPlayer(id,displayTitle,0);
    }
    private void openPlayer(String id,String displayTitle,long resumePosition) {
        android.view.inputmethod.InputMethodManager keyboard=(android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE);
        if(keyboard!=null)keyboard.hideSoftInputFromWindow(web.getWindowToken(),0);
        long generation=++playerGeneration;
        if(playTask!=null)playTask.abort();
        // A background poll/partial request could supersede the two mandatory
        // playback grants even after its own HTTP 200. Cancel ONLY the optional
        // bridge work; do not serialize fresh playback checks behind catalog.
        for(Task task:new ArrayList<>(tasks.values()))
            if((task.optionalApi||task.backgroundGrant)&&!task.isDone()){
                task.abort();
                if(task.callback!=null)respond(task.callback,task.id,null,"PLAYBACK_BUSY");
            }
        stopMedia("new-request");
        String initialTitle=displayTitle!=null&&!displayTitle.trim().isEmpty()
            ? displayTitle.trim().substring(0,Math.min(200,displayTitle.trim().length()))
            : "טוענים את פרטי הסרטון…";
        active=new NativeApi.Playback(id,initialTitle,List.of());
        web.evaluateJavascript("window.dispatchEvent(new Event('kids-native-playback-open'))",null);
        logPlayback(generation,"request",null);
        sourceIndex=0;sourceOrder=List.of();resumeAt=Math.max(0,resumePosition);
        playbackStartedAt=android.os.SystemClock.elapsedRealtime();
        overlay.setVisibility(View.VISIBLE);web.setVisibility(View.INVISIBLE);
        title.setText(initialTitle);showLoading(true);showMessage("מתחבר...");retry.setVisibility(View.GONE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // Two fresh grant checks still bracket extraction on slow links.
        RequestScope scope=new RequestScope(85000);
        playTask=new Task("player",scope,()->{
            scope.enter();
            try {
                logPlayback(generation,"fresh-auth-and-extraction-start",null);
                long extractionStarted=android.os.SystemClock.elapsedRealtime();
                NativeApi.Playback result=api.playback(id,generation);scope.check();
                logPlayback(generation,"extraction-success sources="+result.sources.size()+
                    " elapsedMs="+(android.os.SystemClock.elapsedRealtime()-extractionStarted),null);
                handler.post(()->{
                    if(destroyed || generation!=playerGeneration || scope.cancelled)return;
                    active=result;
                    List<Integer> rates=new ArrayList<>(),heights=new ArrayList<>();
                    for(NativeApi.Source source:result.sources){rates.add(source.bitrate);heights.add(source.height);}
                    sourceOrder=PlaybackChoices.order(rates,heights,qualityMode,observedBandwidthBps);
                    sourceIndex=0;
                    if(result.title!=null&&!result.title.isBlank()&&!result.title.equals("סרטון מאושר"))
                        title.setText(result.title);
                    trySource(generation);
                });
            }catch(Exception e){
                logPlayback(generation,"playback-preparation-failed",e);
                api.recordFailure(e);
                final String code=NativeApi.errorCode(e);
                handler.post(()->{if(!destroyed && generation==playerGeneration)unavailable(code);});
            }finally {
                // Do not mark a completed task "cancelled": its posted result still
                // has to pass the generation guard on the UI thread.
                RequestScope.CURRENT.remove();
            }
            return null;
        });
        try{playbackWorkers.execute(playTask);}catch(RejectedExecutionException e){playTask.abort();unavailable();}
    }
    static OkHttpClient mediaClient(OkHttpClient base) {
        // Extractor requests intentionally keep redirects disabled. Signed Googlevideo
        // media URLs can redirect between HTTPS media hosts. Follow those redirects
        // ourselves so every Location target is validated before connecting to it.
        return base.newBuilder()
                // Progressive media transfers must not inherit the extractor 12s call cap.
                .callTimeout(0,TimeUnit.MILLISECONDS)
                .connectTimeout(8,TimeUnit.SECONDS)
                .readTimeout(20,TimeUnit.SECONDS)
                .followRedirects(false)
                .followSslRedirects(false)
                .addInterceptor(chain->{
                    okhttp3.Request request=chain.request();
                    for(int redirects=0;;redirects++){
                        if(!ApprovalPolicy.safeMedia(request.url().toString()))
                            throw new IOException("INVALID_MEDIA_REDIRECT");
                        okhttp3.Response response=chain.proceed(request);
                        if(!response.isRedirect()){
                            if(response.code()==401 || response.code()==403){
                                response.close();throw new IOException("UPSTREAM_BLOCKED");
                            }
                            if(response.code()==429){
                                response.close();throw new IOException("RATE_LIMITED");
                            }
                            return response;
                        }
                        if(redirects>=4){
                            response.close();throw new IOException("TOO_MANY_MEDIA_REDIRECTS");
                        }
                        okhttp3.HttpUrl next;
                        try {next=safeMediaRedirect(response.request().url(),response.header("Location"));}
                        catch(IOException error){response.close();throw error;}
                        response.close();
                        request=request.newBuilder().url(next).build();
                    }
                }).build();
    }
    static okhttp3.HttpUrl safeMediaRedirect(okhttp3.HttpUrl current,String location) throws IOException {
        okhttp3.HttpUrl next=location==null?null:current.resolve(location);
        if(next==null || !ApprovalPolicy.safeMedia(next.toString()))
            throw new IOException("INVALID_MEDIA_REDIRECT");
        return next;
    }
    private void trySource(long generation) {
        if(destroyed || generation!=playerGeneration || active==null)return;
        stopMedia("switch-source");
        if(sourceIndex>=Math.min(sourceOrder.size(),6)
                || android.os.SystemClock.elapsedRealtime()-playbackStartedAt>120000){unavailable("SLOW_CONNECTION");return;}
        showLoading(true);showMessage(sourceIndex==0?"מתחבר בחיבור איטי…":"מנסה איכות חלופית…");
        NativeApi.Source source=active.sources.get(sourceOrder.get(sourceIndex++));
        logPlayback(generation,"media-source-"+sourceIndex+" of "+sourceOrder.size()+
                " height="+source.height+" bitrate="+source.bitrate,null);
        OkHttpClient mediaClient=mediaClient(api.downloader.client);
        OkHttpDataSource.Factory dataSource=new OkHttpDataSource.Factory(mediaClient)
                .setTransferListener(bandwidthMeter.getTransferListener());
        ProgressiveMediaSource.Factory factory=new ProgressiveMediaSource.Factory(dataSource)
                .setLoadErrorHandlingPolicy(new DefaultLoadErrorHandlingPolicy(0));
        MediaSource video=factory.createMediaSource(MediaItem.fromUri(source.video));
        MediaSource media=source.audio==null?video:new MergingMediaSource(video,
                factory.createMediaSource(MediaItem.fromUri(source.audio)));
        DefaultLoadControl buffer=new DefaultLoadControl.Builder()
                .setBufferDurationsMs(16000,45000,2500,5500)
                .setTargetBufferBytes(12*1024*1024).build();
        ExoPlayer attempt=new ExoPlayer.Builder(this).setLoadControl(buffer).build();
        player=attempt;mediaOwnerGeneration=generation;
        final int playingSourceIndex=sourceIndex;
        final long mediaStarted=android.os.SystemClock.elapsedRealtime();
        attempt.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),true);
        playerView.setPlayer(attempt);
        attempt.addListener(new Player.Listener(){
            private boolean failed,ready;
            private long lastBuffered;
            private void watchBuffer(){
                cancelPlayerTimeout();
                lastBuffered=attempt.getBufferedPosition();
                playerTimeout=()->{
                    if(failed||generation!=playerGeneration||player!=attempt||
                            attempt.getPlaybackState()!=Player.STATE_BUFFERING)return;
                    long elapsed=android.os.SystemClock.elapsedRealtime()-playbackStartedAt;
                    long buffered=attempt.getBufferedPosition();
                    int next=sourceIndex<sourceOrder.size()?sourceOrder.get(sourceIndex):-1;
                    boolean lower=next>=0&&active!=null&&active.sources.get(next).bitrate<source.bitrate;
                    boolean sustainedSlow=observedBandwidthBps>0
                            &&observedBandwidthBps<source.bitrate*7L/10L;
                    if(lower&&(sustainedSlow||buffered-lastBuffered<6000)){
                        // One 20s buffering sample is not a short network fluctuation.
                        // Move down, never oscillate upward on a slow-link stall.
                        advance(new IOException("SLOW_LINK_DOWNGRADE"));
                    }else if(buffered>lastBuffered+1000&&elapsed<110000){
                        watchBuffer();
                    }else advance(new IOException("TIMEOUT"));
                };
                handler.postDelayed(playerTimeout,20000);
            }
            private void advance(Throwable error){
                if(failed || generation!=playerGeneration || player!=attempt)return;
                failed=true;resumeAt=Math.max(resumeAt,attempt.getCurrentPosition());
                String code=NativeApi.errorCode(error);
                logPlayback(generation,error instanceof PlaybackException
                    ? "media3-error-code-"+((PlaybackException)error).errorCode
                    : "media-source-failed",error);
                if(code.equals("UPSTREAM_BLOCKED") || code.equals("RATE_LIMITED")){
                    api.recordFailure(error);unavailable(code);
                }else if(error instanceof IOException && "TIMEOUT".equals(error.getMessage())
                        && (sourceIndex>=sourceOrder.size()
                        || active.sources.get(sourceOrder.get(sourceIndex)).bitrate>=source.bitrate)){
                    unavailable("SLOW_CONNECTION");
                }else trySource(generation);
            }
            @Override public void onPlayerError(PlaybackException error){advance(error);}
            @Override public void onIsPlayingChanged(boolean isPlaying){
                if(generation!=playerGeneration || player!=attempt || failed)return;
                logPlayback(generation,"media3-isPlaying-"+isPlaying+" source="+playingSourceIndex,null);
            }
            @Override public void onRenderedFirstFrame(){
                if(generation!=playerGeneration || player!=attempt || failed)return;
                logPlayback(generation,"media3-first-frame source="+playingSourceIndex+
                    " elapsedMs="+(android.os.SystemClock.elapsedRealtime()-mediaStarted),null);
            }
            @Override public void onPlaybackStateChanged(int state){
                if(generation!=playerGeneration || player!=attempt || failed)return;
                logPlayback(generation,"media3-state-"+media3State(state)+" source="+playingSourceIndex+
                    " elapsedMs="+(android.os.SystemClock.elapsedRealtime()-mediaStarted),null);
                if(state==Player.STATE_READY){
                    ready=true;cancelPlayerTimeout();showLoading(false);showMessage("");
                }else if(state==Player.STATE_ENDED){
                    cancelPlayerTimeout();showMessage("הסרטון הסתיים. אפשר לחזור ולבחור סרטון אחר.");
                    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }else if(state==Player.STATE_BUFFERING && attempt.getPlayWhenReady()){
                    showLoading(true);
                    showMessage(ready?"ממתין לעוד נתונים…":"טוען וידאו, החיבור עשוי להיות איטי…");
                    watchBuffer();
                }
            }
        });
        attempt.setMediaSource(media);
        if(resumeAt>0)attempt.seekTo(resumeAt);
        attempt.prepare();attempt.play();
        // No playlist, next-video chain, related videos, comments, share or web player.
    }
    private void cancelPlayerTimeout(){if(playerTimeout!=null){handler.removeCallbacks(playerTimeout);playerTimeout=null;}}
    private void stopMedia(){stopMedia("unspecified");}
    private void stopMedia(String reason){
        cancelPlayerTimeout();
        if(player!=null){
            logPlayback(mediaOwnerGeneration,"player-release reason="+reason,null);
            playerView.setPlayer(null);player.stop();player.release();player=null;
        }
    }
    private void unavailable(){unavailable("VIDEO_UNAVAILABLE");}
    private void unavailable(String code){
        stopMedia("unavailable-"+code);showLoading(false);
        String reason="לא הצלחנו להפעיל את הסרטון. אפשר לנסות שוב.";
        if("NOT_APPROVED".equals(code))reason="הסרטון כבר אינו מאושר לצפייה.";
        else if("NO_SUPPORTED_STREAM".equals(code))reason="לא נמצא מקור וידאו וקול מתאים לסרטון הזה.";
        else if("UPSTREAM_BLOCKED".equals(code))reason="YouTube חסם את בקשת הניגון. נסו שוב מאוחר יותר.";
        else if("RATE_LIMITED".equals(code))reason="שירות הסרטונים הגביל בקשות. נסו שוב מאוחר יותר.";
        else if("TIMEOUT".equals(code))reason="הטעינה ארכה יותר מדי זמן. בדקו את החיבור ונסו שוב.";
        else if("SLOW_CONNECTION".equals(code)||"DNS_ERROR".equals(code)||"NETWORK_ERROR".equals(code))
            reason="החיבור איטי או לא יציב. נסו שוב כשיש קליטה טובה יותר.";
        showMessage(reason);
        retry.setVisibility(View.VISIBLE);getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    private void closePlayer(){
        ++playerGeneration;if(playTask!=null){playTask.abort();playTask=null;}
        boolean wasOpen=active!=null;
        stopMedia("close-player");showLoading(false);active=null;sourceOrder=List.of();overlay.setVisibility(View.GONE);web.setVisibility(View.VISIBLE);
        if(wasOpen && !destroyed && web!=null)
            web.evaluateJavascript("window.dispatchEvent(new Event('kids-native-playback-closed'))",null);
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    @Override public void onBackPressed(){if(active!=null)closePlayer();else super.onBackPressed();}
    @Override protected void onStop(){
        if(active!=null){logPlayback(playerGeneration,"activity-onStop",null);closePlayer();}
        super.onStop();
    }
    @Override protected void onDestroy(){
        if(bandwidthMeter!=null&&bandwidthListener!=null)bandwidthMeter.removeEventListener(bandwidthListener);
        destroyed=true;closePlayer();
        for(Task task:tasks.values())task.abort();tasks.clear();workers.shutdownNow();authorizationWorkers.shutdownNow();playbackWorkers.shutdownNow();api.cancelAll();
        if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))
            WebViewCompat.removeWebMessageListener(web,"KidsAndroid");
        // Chromium requires detaching a WebView from its parent before destroy().
        android.view.ViewParent parent=web.getParent();
        if(parent instanceof android.view.ViewGroup)((android.view.ViewGroup)parent).removeView(web);
        web.destroy();super.onDestroy();
    }
}
