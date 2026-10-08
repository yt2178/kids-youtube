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
    private final Map<String,Task> tasks=new HashMap<>();
    private WebView web;
    private NativeApi api;
    private LinearLayout overlay;
    private TextView title,message;
    private ProgressBar loading;
    private Button retry;
    private PlayerView playerView;
    private ExoPlayer player;
    private Task playTask;
    private long playerGeneration;
    private NativeApi.Playback active;
    private int sourceIndex;
    private long resumeAt;
    private Runnable playerTimeout;
    private boolean destroyed;
    private long startupStartedAt;
    private void debugStartup(String stage){
        if((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)==0)return;
        android.util.Log.d("KidsStartup",stage+" elapsedMs="+
                (android.os.SystemClock.elapsedRealtime()-startupStartedAt)+
                " build="+getString(R.string.kids_build_sha));
    }

    private final class Task extends FutureTask<Void> {
        final String id;
        final RequestScope scope;
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
        retry.setOnClickListener(v->{if(active!=null)openPlayer(active.id);});
        overlay.addView(retry,new LinearLayout.LayoutParams(-1,dp(64)));
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
                    android.util.Log.d("KidsWeb",message.messageLevel()+": "+message.message()+
                            " @"+message.sourceId()+":"+message.lineNumber());
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
            if(!Set.of("whitelist","api","clear").contains(method)){
                respond(reply,id,null,"INVALID_REQUEST");return;
            }
            RequestScope scope=new RequestScope(14000);
            String argument=data.optString("argument","");
            Task task=new Task(id,scope,()->{
                scope.enter();
                try {
                    Object result;
                    if(method.equals("whitelist"))result=api.displayWhitelist();
                    else if(method.equals("clear")){api.clear();result=Boolean.TRUE;}
                    else result=api.request(argument);
                    scope.check();respond(reply,id,result,null);
                }catch(Exception e){if(!scope.cancelled)respond(reply,id,null,NativeApi.errorCode(e));}
                finally{scope.close();}
                return null;
            });
            tasks.put(id,task);
            try{workers.execute(task);}catch(RejectedExecutionException e){
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
        String detail=failure==null?"":(" type="+failure.getClass().getSimpleName()+
            " cause="+(failure.getCause()==null?"none":failure.getCause().getClass().getSimpleName())+
            " category="+NativeApi.errorCode(failure));
        android.util.Log.d("KidsPlayback","request="+generation+" stage="+stage+detail);
    }
    private void openPlayer(String id,String displayTitle) {
        android.view.inputmethod.InputMethodManager keyboard=(android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE);
        if(keyboard!=null)keyboard.hideSoftInputFromWindow(web.getWindowToken(),0);
        long generation=++playerGeneration;
        if(playTask!=null)playTask.abort();
        stopMedia();
        String initialTitle=displayTitle!=null&&!displayTitle.trim().isEmpty()
            ? displayTitle.trim().substring(0,Math.min(200,displayTitle.trim().length()))
            : "טוענים את פרטי הסרטון…";
        active=new NativeApi.Playback(id,initialTitle,List.of());
        logPlayback(generation,"request",null);
        sourceIndex=0;resumeAt=0;
        overlay.setVisibility(View.VISIBLE);web.setVisibility(View.INVISIBLE);
        title.setText(initialTitle);showLoading(true);showMessage("מתחבר...");retry.setVisibility(View.GONE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        RequestScope scope=new RequestScope(20000);
        playTask=new Task("player",scope,()->{
            scope.enter();
            try {
                logPlayback(generation,"fresh-auth-and-extraction-start",null);
                NativeApi.Playback result=api.playback(id);scope.check();
                logPlayback(generation,"extraction-success sources="+result.sources.size(),null);
                handler.post(()->{
                    if(destroyed || generation!=playerGeneration || scope.cancelled)return;
                    active=result;
                    if(result.title!=null&&!result.title.isBlank()&&!result.title.equals("סרטון מאושר"))
                        title.setText(result.title);
                    trySource(generation);
                });
            }catch(Exception e){
                logPlayback(generation,"extraction-failed",e);
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
        try{workers.execute(playTask);}catch(RejectedExecutionException e){playTask.abort();unavailable();}
    }
    static OkHttpClient mediaClient(OkHttpClient base) {
        // Extractor requests intentionally keep redirects disabled. Signed Googlevideo
        // media URLs can redirect between HTTPS media hosts. Follow those redirects
        // ourselves so every Location target is validated before connecting to it.
        return base.newBuilder()
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
        stopMedia();
        if(sourceIndex>=active.sources.size()){unavailable();return;}
        showLoading(true);showMessage(sourceIndex==0?"מתחבר...":"מחפש מקור חלופי...");
        NativeApi.Source source=active.sources.get(sourceIndex++);
        logPlayback(generation,"media-source-"+sourceIndex+" of "+active.sources.size(),null);
        OkHttpClient mediaClient=mediaClient(api.downloader.client);
        OkHttpDataSource.Factory dataSource=new OkHttpDataSource.Factory(mediaClient);
        ProgressiveMediaSource.Factory factory=new ProgressiveMediaSource.Factory(dataSource)
                .setLoadErrorHandlingPolicy(new DefaultLoadErrorHandlingPolicy(0));
        MediaSource video=factory.createMediaSource(MediaItem.fromUri(source.video));
        MediaSource media=source.audio==null?video:new MergingMediaSource(video,
                factory.createMediaSource(MediaItem.fromUri(source.audio)));
        ExoPlayer attempt=new ExoPlayer.Builder(this).build();player=attempt;
        attempt.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),true);
        playerView.setPlayer(attempt);
        attempt.addListener(new Player.Listener(){
            private boolean failed,ready;
            private void advance(Throwable error){
                if(failed || generation!=playerGeneration || player!=attempt)return;
                failed=true;resumeAt=Math.max(resumeAt,attempt.getCurrentPosition());
                String code=NativeApi.errorCode(error);
                logPlayback(generation,error instanceof PlaybackException
                    ? "media3-error-code-"+((PlaybackException)error).errorCode
                    : "media-source-failed",error);
                if(code.equals("UPSTREAM_BLOCKED") || code.equals("RATE_LIMITED")){
                    api.recordFailure(error);unavailable(code);
                }else trySource(generation);
            }
            @Override public void onPlayerError(PlaybackException error){advance(error);}
            @Override public void onPlaybackStateChanged(int state){
                if(generation!=playerGeneration || player!=attempt || failed)return;
                if(state==Player.STATE_READY){
                    ready=true;cancelPlayerTimeout();showLoading(false);showMessage("");
                }else if(state==Player.STATE_ENDED){
                    cancelPlayerTimeout();showMessage("הסרטון הסתיים. אפשר לחזור ולבחור סרטון אחר.");
                    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }else if(state==Player.STATE_BUFFERING && ready && attempt.getPlayWhenReady()){
                    cancelPlayerTimeout();
                    playerTimeout=()->advance(new IOException("TIMEOUT"));
                    handler.postDelayed(playerTimeout,8000);
                }
            }
        });
        playerTimeout=()->{
            if(generation==playerGeneration && player==attempt){resumeAt=Math.max(resumeAt,attempt.getCurrentPosition());trySource(generation);}
        };
        handler.postDelayed(playerTimeout,8000);
        attempt.setMediaSource(media);
        if(resumeAt>0)attempt.seekTo(resumeAt);
        attempt.prepare();attempt.play();
        // No playlist, next-video chain, related videos, comments, share or web player.
    }
    private void cancelPlayerTimeout(){if(playerTimeout!=null){handler.removeCallbacks(playerTimeout);playerTimeout=null;}}
    private void stopMedia(){
        cancelPlayerTimeout();
        if(player!=null){playerView.setPlayer(null);player.stop();player.release();player=null;}
    }
    private void unavailable(){unavailable("VIDEO_UNAVAILABLE");}
    private void unavailable(String code){
        stopMedia();showLoading(false);
        String reason="לא הצלחנו להפעיל את הסרטון. אפשר לנסות שוב.";
        if("NOT_APPROVED".equals(code))reason="הסרטון כבר אינו מאושר לצפייה.";
        else if("NO_SUPPORTED_STREAM".equals(code))reason="לא נמצא מקור וידאו וקול מתאים לסרטון הזה.";
        else if("UPSTREAM_BLOCKED".equals(code))reason="YouTube חסם את בקשת הניגון. נסו שוב מאוחר יותר.";
        else if("RATE_LIMITED".equals(code))reason="שירות הסרטונים הגביל בקשות. נסו שוב מאוחר יותר.";
        else if("TIMEOUT".equals(code))reason="הטעינה ארכה יותר מדי זמן. בדקו את החיבור ונסו שוב.";
        showMessage(reason);
        retry.setVisibility(View.VISIBLE);getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    private void closePlayer(){
        ++playerGeneration;if(playTask!=null){playTask.abort();playTask=null;}
        stopMedia();showLoading(false);active=null;overlay.setVisibility(View.GONE);web.setVisibility(View.VISIBLE);
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    @Override public void onBackPressed(){if(active!=null)closePlayer();else super.onBackPressed();}
    @Override protected void onStop(){
        if(active!=null)closePlayer();
        super.onStop();
    }
    @Override protected void onDestroy(){
        destroyed=true;closePlayer();
        for(Task task:tasks.values())task.abort();tasks.clear();workers.shutdownNow();api.cancelAll();
        if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))
            WebViewCompat.removeWebMessageListener(web,"KidsAndroid");
        web.destroy();super.onDestroy();
    }
}
