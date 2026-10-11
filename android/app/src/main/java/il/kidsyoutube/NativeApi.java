// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import android.content.Context;
import java.io.IOException;
import java.net.URI;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import okhttp3.*;
import org.json.*;
import org.schabi.newpipe.extractor.*;
import org.schabi.newpipe.extractor.channel.ChannelInfo;
import org.schabi.newpipe.extractor.channel.tabs.*;
import org.schabi.newpipe.extractor.linkhandler.ListLinkHandler;
import org.schabi.newpipe.extractor.stream.*;

/** Local equivalent of the existing UI's small Invidious metadata contract. */
final class NativeApi {
    private final String listUrl;
    static final long LIST_TTL=30000, META_TTL=6*60*60*1000, CHANNEL_TTL=5*60*1000;
    final ExtractorDownloader downloader;
    private volatile ApprovalPolicy policy=ApprovalPolicy.parse("");
    private volatile String raw="";
    private JSONObject lastAuthorization;
    private volatile long checkedAt;
    private final Map<String,Alias> aliases=new ConcurrentHashMap<>();
    private final Map<String,Cache> cache=new ConcurrentHashMap<>();
    private final Map<String,Cursor> cursors=new ConcurrentHashMap<>();
    private volatile long cooldownUntil;
    private volatile boolean extractorReady;
    private final Object extractorInitLock=new Object();
    // A completed older request must never replace an authorization request
    // started later (including when a cancelled request finishes late).
    private final AtomicLong authorizationGeneration=new AtomicLong();
    private final boolean debugBuild;
    // Test-only transport seam: calls exercise the same production whitelist.
    NativeApi(ExtractorDownloader downloader,String listUrl) {
        this.downloader=downloader;this.listUrl=listUrl;this.debugBuild=false;
    }
    NativeApi(Context context) {
        // Do not initialize NewPipe on Activity.onCreate's UI thread.
        debugBuild=(context.getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0;
        downloader=new ExtractorDownloader(debugBuild);
        listUrl=context.getString(R.string.kids_list_url);
    }
    private void ensureExtractor() {
        if(extractorReady)return;
        synchronized(extractorInitLock){
            if(extractorReady)return;
            long started=android.os.SystemClock.elapsedRealtime();
            NewPipe.init(downloader);
            extractorReady=true;
            if(debugBuild)
                android.util.Log.d("KidsStartup","newpipe-init-worker-ms="+
                        (android.os.SystemClock.elapsedRealtime()-started));
        }
    }
    private static final class Alias {
        final String id;final long expires;
        Alias(String id){this.id=id;expires=System.currentTimeMillis()+CHANNEL_TTL;}
    }
    private static final class Cache {
        final Object data;final long expires;final String authority;
        Cache(Object data,long ttl,String authority){this.data=data;expires=System.currentTimeMillis()+ttl;this.authority=authority;}
    }
    private static final class Cursor {
        final String channel,authority;
        final List<ListLinkHandler> tabs;
        final int tab;
        final Page page;
        final long expires=System.currentTimeMillis()+10*60*1000;
        Cursor(String channel,String authority,List<ListLinkHandler> tabs,int tab,Page page) {
            this.channel=channel;this.authority=authority;this.tabs=tabs;this.tab=tab;this.page=page;
        }
    }
    String whitelist(boolean force) throws Exception {
        return whitelist(force,true);
    }
    static boolean retryableAuthorizationTransport(IOException error) {
        // Only safe-to-repeat GET transport failures, never certificate errors,
        // read/header timeouts, HTTP denials, or malformed grant documents.
        if(error instanceof javax.net.ssl.SSLException)return false;
        return error instanceof java.net.UnknownHostException
                ||error instanceof java.net.ConnectException
                ||error instanceof java.net.NoRouteToHostException
                ||error instanceof java.net.SocketException;
    }
    String whitelist(boolean force,boolean withDisplayCatalog) throws Exception {
        // Authorization requests never wait behind NewPipe's init monitor.
        // Retrying must remain inside ONE authorization generation: an older
        // reply cannot commit even if a newer request completes during retry.
        synchronized(this){
            if(!force && checkedAt>0 && System.currentTimeMillis()-checkedAt<LIST_TTL)
                return raw;
        }
        RequestScope scope=RequestScope.CURRENT.get();if(scope!=null)scope.check();
        final long generation=authorizationGeneration.incrementAndGet();
        if(force)synchronized(this){checkedAt=0;lastAuthorization=null;}
        okhttp3.HttpUrl endpoint=Objects.requireNonNull(okhttp3.HttpUrl.parse(listUrl));
        if(!withDisplayCatalog)endpoint=endpoint.newBuilder().addQueryParameter("detail","grants").build();
        okhttp3.Request request=new okhttp3.Request.Builder().url(endpoint)
                .header("Cache-Control","no-cache").tag(String.class,"authorization").build();
        for(int attempt=1;attempt<=2;attempt++){
            if(scope!=null)scope.check();
            Call call=downloader.authorizationClient.newCall(request);
            try{
                if(scope!=null){
                    scope.add(call);
                    // Native task (34s) must outlive all wire attempts including
                    // body parsing. Never let a late retry exceed that deadline.
                    long remaining=scope.deadline-System.currentTimeMillis()-250;
                    if(remaining<=0){scope.check();throw new java.io.InterruptedIOException("TIMEOUT");}
                    call.timeout().timeout(Math.min(32000,remaining),java.util.concurrent.TimeUnit.MILLISECONDS);
                }
                try(okhttp3.Response response=call.execute()){
                    if(!response.isSuccessful()){
                        int status=response.code();
                        if(status==409)throw new IOException("AUTH_CHANGED_RETRY");
                        if(status==429)throw new IOException("RATE_LIMITED");
                        if(status>=400&&status<500)throw new IOException("AUTH_DENIED");
                        throw new IOException("WHITELIST_UNAVAILABLE");
                    }
                    String responseBody=ExtractorDownloader.readBounded(response.body(),1000000);
                    JSONObject doc;
                    try{doc=new JSONObject(responseBody);}catch(JSONException e){throw new IOException("INVALID_AUTH_RESPONSE",e);}
                    String text=doc.optString("list","");
                    if(!doc.has("list")||!doc.has("version")||text.length()>1000000)
                        throw new IOException("INVALID_AUTH_RESPONSE");
                    ApprovalPolicy next=ApprovalPolicy.parse(text);
                    Map<String,Alias> pinned=new HashMap<>();
                    JSONArray pins=doc.optJSONArray("pinnedChannels");
                    if(pins!=null)for(int i=0;i<Math.min(500,pins.length());i++){
                        JSONObject item=pins.optJSONObject(i);if(item==null)continue;
                        String url=item.optString("url",""),id=item.optString("id","");
                        if(next.channelUrls.contains(url)&&ApprovalPolicy.CHANNEL.matcher(id).matches())
                            pinned.put(url,new Alias(id));
                    }
                    if(scope!=null)scope.check();
                    long entered=System.nanoTime();
                    synchronized(this){
                        if(debugBuild&&scope!=null)scope.phase("authorization-state-lock-wait",
                                java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-entered));
                        if(scope!=null)scope.check();
                        if(generation!=authorizationGeneration.get())
                            throw new IOException("AUTH_SUPERSEDED");
                        if(!next.fingerprint.equals(policy.fingerprint)){cache.clear();cursors.clear();}
                        aliases.clear();aliases.putAll(pinned);
                        raw=text;policy=next;lastAuthorization=doc;checkedAt=System.currentTimeMillis();
                        return text;
                    }
                }
            }catch(IOException error){
                if(attempt==2 || !retryableAuthorizationTransport(error))throw error;
                if(scope!=null)scope.check();
                // Log only request phase and error class; no URL or list text.
                if(debugBuild)android.util.Log.d("KidsNetwork","kind=authorization"+
                        (scope==null?"":scope.trace())+" phase=transport-retry attempt="+attempt+
                        " category="+errorCode(error)+" remainingMs="+
                        (scope==null?0:Math.max(0,scope.deadline-System.currentTimeMillis())));
                try{Thread.sleep(350);}catch(InterruptedException interrupted){
                    Thread.currentThread().interrupt();
                    throw new java.io.InterruptedIOException("TIMEOUT");
                }
                if(scope!=null)scope.check();
            }finally{
                if(scope!=null)scope.remove(call);
            }
        }
        throw new IOException("WHITELIST_UNAVAILABLE");
    }
    String displayWhitelist() throws Exception {
        // Fail closed: stale approvals are never displayed as current approvals.
        return whitelist(true);
    }
    JSONObject sharedCatalog(JSONObject expected) throws Exception {
        if(expected==null || !expected.has("version") || !expected.has("updatedAt"))
            throw new IOException("INVALID_REQUEST");
        final int version=expected.optInt("version",-1);
        final String updatedAt=expected.optString("updatedAt","");
        if(version<0||updatedAt.isEmpty())throw new IOException("INVALID_REQUEST");
        // This operation is display-only; authority must first come from the
        // current successful fresh native authorization for the same load.
        synchronized(this){
            if(lastAuthorization==null || checkedAt==0
                    || lastAuthorization.optInt("version",-2)!=version
                    || !updatedAt.equals(lastAuthorization.optString("updatedAt","")))
                throw new IOException("CATALOG_AUTH_CHANGED");
        }
        if(!listUrl.endsWith("?action=list&format=native"))
            throw new IOException("INVALID_CATALOG_ENDPOINT");
        final String catalogUrl=listUrl.substring(0,listUrl.indexOf('?'))+"?action=catalog";
        RequestScope scope=RequestScope.CURRENT.get();if(scope!=null)scope.check();
        okhttp3.Request request=new okhttp3.Request.Builder().url(catalogUrl)
                .header("Cache-Control","no-cache").tag(String.class,"catalog").build();
        Call call=downloader.client.newCall(request);if(scope!=null)scope.add(call);
        try(okhttp3.Response response=call.execute()){
            if(!response.isSuccessful())throw new IOException("CATALOG_UNAVAILABLE");
            JSONObject data=new JSONObject(ExtractorDownloader.readBounded(response.body(),1500000));
            if(data.optInt("version",-2)!=version
                    || !updatedAt.equals(data.optString("updatedAt","")))
                throw new IOException("CATALOG_AUTH_CHANGED");
            synchronized(this){
                if(lastAuthorization==null || lastAuthorization.optInt("version",-2)!=version
                        || !updatedAt.equals(lastAuthorization.optString("updatedAt","")))
                    throw new IOException("CATALOG_AUTH_CHANGED");
            }
            if(scope!=null)scope.check();
            return data;
        }finally{if(scope!=null)scope.remove(call);}
    }

    JSONObject tracedDisplayAuthorization() throws Exception {
        return displayAuthorization(true);
    }
    JSONObject tracedDisplayAuthorization(boolean withDisplayCatalog) throws Exception {
        return displayAuthorization(withDisplayCatalog);
    }
    JSONObject displayAuthorization() throws Exception {
        return displayAuthorization(true);
    }
    JSONObject displayAuthorization(boolean withDisplayCatalog) throws Exception {
        // Full catalog on initial load only. Polling still fetches fresh grants.
        whitelist(true,withDisplayCatalog);
        synchronized(this){
            if(lastAuthorization==null || !lastAuthorization.has("updatedAt")
                    || !lastAuthorization.has("version")
                    || lastAuthorization.optInt("catalogVersion",-1)!=1)
                throw new IOException("INVALID_AUTH_RESPONSE");
            return new JSONObject(lastAuthorization.toString());
        }
    }
    private void checkNetwork() throws IOException {
        RequestScope scope=RequestScope.CURRENT.get();if(scope!=null)scope.check();
        if(System.currentTimeMillis()<cooldownUntil)throw new IOException("UPSTREAM_BLOCKED");
    }
    private Set<String> approvedChannels() {
        Set<String> result=new HashSet<>(policy.channels);
        aliases.forEach((url,alias)->{
            if(policy.channelUrls.contains(url) && System.currentTimeMillis()<alias.expires)result.add(alias.id);
        });
        return result;
    }
    private ChannelInfo channel(String url) throws Exception {
        checkNetwork();
        ChannelInfo info=ChannelInfo.getInfo(ServiceList.YouTube,url);
        if(!ApprovalPolicy.CHANNEL.matcher(info.getId()).matches())throw new IOException("INVALID_CHANNEL");
        return info;
    }
    private ChannelInfo approvedChannel(String id) throws Exception {
        if(!approvedChannels().contains(id))throw new IOException("NOT_APPROVED");
        Cache item=cache.get("channel:"+id);
        if(valid(item))return (ChannelInfo)item.data;
        ChannelInfo info=channel("https://www.youtube.com/channel/"+id);
        if(!id.equals(info.getId()))throw new IOException("INVALID_CHANNEL");
        put("channel:"+id,info,CHANNEL_TTL);return info;
    }
    private boolean valid(Cache item) {
        return item!=null && item.expires>System.currentTimeMillis() && item.authority.equals(policy.fingerprint);
    }
    private void put(String key,Object value,long ttl) {
        cache.entrySet().removeIf(e->!valid(e.getValue()));
        if(cache.size()>=200)cache.clear();
        cache.put(key,new Cache(value,ttl,policy.fingerprint));
    }
    Object request(String path) throws Exception {
        whitelist(false,false);
        ensureExtractor();
        if(path==null || path.length()>22000)throw new IOException("INVALID_REQUEST");
        Cache hit=cache.get(path);if(valid(hit))return hit.data;
        try {
            Object result;
            if(path.startsWith("/api/v1/resolveurl?url=")) {
                String input=java.net.URLDecoder.decode(path.substring(23),java.nio.charset.StandardCharsets.UTF_8);
                ApprovalPolicy.Link link=ApprovalPolicy.classify(input);
                if(link.videoId!=null || !policy.channelUrls.contains(link.url))throw new IOException("NOT_APPROVED");
                ChannelInfo info=channel(link.url);
                aliases.put(link.url,new Alias(info.getId()));
                put("channel:"+info.getId(),info,CHANNEL_TTL);
                result=new JSONObject().put("ucid",info.getId()).put("browseId",info.getId());
            } else if(path.matches("/api/v1/videos/[A-Za-z0-9_-]{11}")) {
                String id=path.substring("/api/v1/videos/".length());
                StreamExtractor extractor=extractVideo(id);
                String author=authorId(extractor.getUploaderUrl());
                if(!policy.allows(id,author,approvedChannels()))throw new IOException("NOT_APPROVED");
                result=metadata(extractor,id,author);
            } else if(path.matches("/api/v1/channels/UC[A-Za-z0-9_-]{22}")) {
                ChannelInfo info=approvedChannel(path.substring("/api/v1/channels/".length()));
                JSONArray images=new JSONArray();
                for(Image image:info.getAvatars())images.put(new JSONObject().put("url",image.getUrl())
                        .put("width",image.getWidth()).put("height",image.getHeight()));
                result=new JSONObject().put("authorId",info.getId()).put("author",clean(info.getName()))
                        .put("authorThumbnails",images).put("subCount",info.getSubscriberCount());
            } else if(path.matches("/api/v1/channels/UC[A-Za-z0-9_-]{22}/videos(\\?continuation=[A-Za-z0-9%-]+)?")) {
                String rest=path.substring("/api/v1/channels/".length());
                String id=rest.substring(0,24);
                String token=path.contains("?") ? ApprovalPolicy.query(URI.create("https://local"+path).getRawQuery(),"continuation") : null;
                result=channelPage(id,token);
            } else throw new IOException("INVALID_REQUEST");
            put(path,result,path.startsWith("/api/v1/videos/")?META_TTL:CHANNEL_TTL);
            return result;
        } catch(Exception e){recordFailure(e);throw e;}
    }
    private StreamExtractor extractVideo(String id) throws Exception {
        if(!ApprovalPolicy.VIDEO.matcher(id).matches())throw new IOException("INVALID_REQUEST");
        checkNetwork();
        StreamExtractor extractor=ServiceList.YouTube.getStreamExtractor("https://www.youtube.com/watch?v="+id);
        extractor.fetchPage();
        if(!id.equals(extractor.getId()))throw new IOException("INVALID_VIDEO");
        return extractor;
    }
    private static String authorId(String url) {
        try {
            ApprovalPolicy.Link link=ApprovalPolicy.classify(url);
            return link.channelId==null ? "" : link.channelId;
        } catch(RuntimeException e){return "";}
    }
    private static String clean(String value) {
        if(value==null || value.trim().isEmpty())return "סרטון מאושר";
        return value.trim().substring(0,Math.min(value.trim().length(),300));
    }
    private static JSONObject metadata(StreamExtractor e,String id,String author) throws Exception {
        long published=0;
        try{if(e.getUploadDate()!=null)published=e.getUploadDate().getInstant().getEpochSecond();}catch(Exception ignored){}
        return new JSONObject().put("videoId",id).put("title",clean(e.getName()))
                .put("authorId",author).put("author",clean(e.getUploaderName())).put("published",published);
    }
    private Object channelPage(String id,String token) throws Exception {
        approvedChannel(id);
        Cursor cursor;
        if(token==null) {
            ChannelInfo info=approvedChannel(id);
            List<ListLinkHandler> tabs=new ArrayList<>();
            for(String kind:List.of(ChannelTabs.VIDEOS,ChannelTabs.SHORTS,ChannelTabs.LIVESTREAMS))
                for(ListLinkHandler handler:info.getTabs())
                    if(handler.getContentFilters().contains(kind))tabs.add(handler);
            cursor=new Cursor(id,policy.fingerprint,tabs,0,null);
        } else {
            cursor=cursors.get(token);
            if(cursor==null || !cursor.channel.equals(id) || !cursor.authority.equals(policy.fingerprint)
                    || cursor.expires<=System.currentTimeMillis())throw new IOException("INVALID_PAGE");
        }
        if(cursor.tab>=cursor.tabs.size())return new JSONObject().put("videos",new JSONArray()).put("continuation",JSONObject.NULL);
        checkNetwork();
        ListLinkHandler handler=cursor.tabs.get(cursor.tab);
        List<InfoItem> rows;
        Page next;
        if(Page.isValid(cursor.page)) {
            ListExtractor.InfoItemsPage<InfoItem> page=ChannelTabInfo.getMoreItems(ServiceList.YouTube,handler,cursor.page);
            rows=page.getItems();next=page.getNextPage();
        } else {
            ChannelTabInfo page=ChannelTabInfo.getInfo(ServiceList.YouTube,handler);
            if(!page.getErrors().isEmpty() && page.getRelatedItems().isEmpty())throw new IOException("PROVIDER_ERROR");
            rows=page.getRelatedItems();next=page.getNextPage();
        }
        JSONArray videos=new JSONArray();Set<String> ids=new HashSet<>();
        for(InfoItem row:rows) {
            if(!(row instanceof StreamInfoItem))continue;
            StreamInfoItem video=(StreamInfoItem)row;
            String vid=ServiceList.YouTube.getStreamLHFactory().getId(video.getUrl());
            String author=authorId(video.getUploaderUrl());
            if(!ApprovalPolicy.VIDEO.matcher(vid).matches() || (!author.isEmpty() && !id.equals(author)) || !ids.add(vid))continue;
            long published=video.getUploadDate()==null?0:video.getUploadDate().getInstant().getEpochSecond();
            videos.put(new JSONObject().put("videoId",vid).put("title",clean(video.getName()))
                    .put("authorId",id).put("author",clean(video.getUploaderName())).put("published",published));
        }
        int nextTab=Page.isValid(next)?cursor.tab:cursor.tab+1;
        String continuation=null;
        if(nextTab<cursor.tabs.size()) {
            cursors.entrySet().removeIf(e->e.getValue().expires<System.currentTimeMillis());
            if(cursors.size()>=500)cursors.clear();
            continuation=UUID.randomUUID().toString();
            cursors.put(continuation,new Cursor(id,policy.fingerprint,cursor.tabs,nextTab,Page.isValid(next)?next:null));
        }
        return new JSONObject().put("videos",videos).put("continuation",continuation==null?JSONObject.NULL:continuation);
    }
    static final class Source {
        final String video,audio;
        final int height,bitrate;
        Source(String video,String audio){this(video,audio,0,0);}
        Source(String video,String audio,int height,int bitrate){
            this.video=video;this.audio=audio;this.height=height;this.bitrate=bitrate;
        }
    }
    static int streamBitrate(VideoStream video){
        int b=video.getBitrate();
        if(b>0)return b;
        int h=resolution(video);
        // Unknown bitrate is an estimate, never presented as a measured value.
        if(h<=144)return 180000;
        if(h<=240)return 350000;
        if(h<=360)return 700000;
        if(h<=480)return 1200000;
        return 2100000;
    }
    static final class Playback {
        final String id,title;
        final List<Source> sources;
        Playback(String id,String title,List<Source> sources){this.id=id;this.title=title;this.sources=sources;}
    }
    Playback playback(String id) throws Exception {
        return playback(id,-1);
    }
    private void debugPlaybackAuthorization(long requestId,String stage) {
        if(debugBuild)android.util.Log.d("KidsPlayback","request="+requestId+" stage="+stage);
    }
    Playback playback(String id,long requestId) throws Exception {
        // Every playback starts from a fresh authoritative parent list.
        whitelist(true,false);
        debugPlaybackAuthorization(requestId,"auth-before-extraction-ok");
        ensureExtractor();
        try {
            StreamExtractor extractor=extractVideo(id);
            String author=authorId(extractor.getUploaderUrl());
            if(!policy.videos.contains(id) && !approvedChannels().contains(author)) {
                // Handles can be resolved again when their five-minute mapping expires.
                for(String url:policy.channelUrls) {
                    if(policy.channels.contains(ApprovalPolicy.classify(url).channelId))continue;
                    ChannelInfo info=channel(url);aliases.put(url,new Alias(info.getId()));
                }
            }
            if(!policy.allows(id,author,approvedChannels()))throw new IOException("NOT_APPROVED");
            if(extractor.getAgeLimit()>0)throw new IOException("VIDEO_UNAVAILABLE");
            // NewPipe provides fixed-quality progressive MP4 links here, not adaptive HLS/DASH.
            List<Source> sources=new ArrayList<>();
            Set<String> seen=new HashSet<>();
            for(VideoStream video:extractor.getVideoStreams()){
                if(compatible(video)&&!video.isVideoOnly()&&seen.add(video.getContent()))
                    sources.add(new Source(video.getContent(),null,resolution(video),streamBitrate(video)));
            }
            AudioStream audio=null;
            for(AudioStream candidate:extractor.getAudioStreams())
                if(candidate.getFormat()==MediaFormat.M4A && candidate.isUrl()
                        && candidate.getDeliveryMethod()==DeliveryMethod.PROGRESSIVE_HTTP
                        && ApprovalPolicy.safeMedia(candidate.getContent())) {audio=candidate;break;}
            if(audio!=null)for(VideoStream video:extractor.getVideoOnlyStreams()){
                if(compatible(video)&&video.isVideoOnly()&&seen.add(video.getContent()))
                    sources.add(new Source(video.getContent(),audio.getContent(),resolution(video),streamBitrate(video)+128000));
            }
            sources.sort(Comparator.comparingInt((Source item)->item.bitrate)
                    .thenComparingInt(item->item.height));
            if(sources.size()>10)sources=new ArrayList<>(sources.subList(0,10));
            if(sources.isEmpty())throw new IOException("NO_SUPPORTED_STREAM");
            RequestScope scope=RequestScope.CURRENT.get();if(scope!=null)scope.check();
            // Re-read the authoritative list after extraction too. A parent may
            // revoke access while network extraction is still in progress.
            whitelist(true,false);
            if(!policy.allows(id,author,approvedChannels()))throw new IOException("NOT_APPROVED");
            debugPlaybackAuthorization(requestId,"auth-after-extraction-ok");
            return new Playback(id,clean(extractor.getName()),sources);
        }catch(Exception e){recordFailure(e);throw e;}
    }
    private static int resolution(VideoStream stream) {
        try{return Integer.parseInt(stream.getResolution().replaceAll("[^0-9].*$",""));}catch(Exception e){return 0;}
    }
    private static boolean compatible(VideoStream stream) {
        int height=resolution(stream);
        return stream.getFormat()==MediaFormat.MPEG_4 && stream.isUrl()
                && stream.getDeliveryMethod()==DeliveryMethod.PROGRESSIVE_HTTP
                && height>0 && height<=720 && ApprovalPolicy.safeMedia(stream.getContent());
    }
    static String errorCode(Throwable error) {
        for(Throwable cause=error;cause!=null;cause=cause.getCause()) {
            String text=String.valueOf(cause.getMessage());
            if(text.contains("NOT_APPROVED"))return "NOT_APPROVED";
            if(text.contains("CATALOG_AUTH_CHANGED"))return "CATALOG_AUTH_CHANGED";
            if(text.contains("AUTH_CHANGED_RETRY"))return "AUTH_CHANGED_RETRY";
            if(text.contains("AUTH_DENIED"))return "AUTH_DENIED";
            if(text.contains("INVALID_AUTH_RESPONSE"))return "INVALID_AUTH_RESPONSE";
            if(text.contains("AUTH_SUPERSEDED"))return "NETWORK_ERROR";
            if(cause instanceof org.schabi.newpipe.extractor.exceptions.ReCaptchaException
                    || text.contains("UPSTREAM_BLOCKED") || text.contains("LOGIN_REQUIRED")
                    || text.toLowerCase(Locale.ROOT).contains("not a bot"))return "UPSTREAM_BLOCKED";
            if(text.contains("RATE_LIMITED"))return "RATE_LIMITED";
            if(cause instanceof java.net.UnknownHostException)return "DNS_ERROR";
            if(cause instanceof javax.net.ssl.SSLException)return "TLS_ERROR";
            if(cause instanceof java.net.ConnectException || cause instanceof java.net.NoRouteToHostException)
                return "CONNECT_ERROR";
            if(cause instanceof java.net.SocketException)return "NETWORK_ERROR";
            if(cause instanceof java.io.InterruptedIOException)return "TIMEOUT";
            if(cause instanceof IOException && (text.contains("WHITELIST_UNAVAILABLE")
                    ||text.contains("CATALOG_UNAVAILABLE")||text.contains("unexpected end of stream")
                    ||text.contains("Connection reset")||text.contains("Canceled")))return "NETWORK_ERROR";
        }
        return "VIDEO_UNAVAILABLE";
    }
    static String safeRootClass(Throwable error){
        Throwable root=error;
        for(int i=0;root!=null&&root.getCause()!=null&&i<10;i++)root=root.getCause();
        return root==null?"Unknown":root.getClass().getSimpleName();
    }
    void recordFailure(Throwable error) {
        String code=errorCode(error);
        if(code.equals("UPSTREAM_BLOCKED"))cooldownUntil=System.currentTimeMillis()+15*60*1000;
        else if(code.equals("RATE_LIMITED"))cooldownUntil=System.currentTimeMillis()+2*60*1000;
    }
    synchronized void clear() {
        authorizationGeneration.incrementAndGet();
        cache.clear();cursors.clear();aliases.clear();checkedAt=0;lastAuthorization=null;
        raw="";policy=ApprovalPolicy.parse("");
        // A block cooldown survives a cache clear.
    }
    void cancelAll() {downloader.client.dispatcher().cancelAll();}
}
