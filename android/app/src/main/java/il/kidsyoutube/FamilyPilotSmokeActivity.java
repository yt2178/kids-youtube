// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.schabi.newpipe.extractor.NewPipe;
import org.schabi.newpipe.extractor.ServiceList;
import org.schabi.newpipe.extractor.MediaFormat;
import org.schabi.newpipe.extractor.stream.StreamExtractor;
import org.schabi.newpipe.extractor.stream.VideoStream;
import org.schabi.newpipe.extractor.stream.DeliveryMethod;

/** Debug-only, time-limited REAL Media3 playback diagnostic.
 * This is intentionally distinct from MainActivity and the legacy approval list.
 * Playback always stops at permit expiry (5 seconds), even if the network hangs.
 */
public final class FamilyPilotSmokeActivity extends Activity {
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final Handler main=new Handler(Looper.getMainLooper());
    private volatile boolean destroyed;
    private volatile boolean visible;
    private volatile FamilyPlaybackLeaseGate gate;
    private ExoPlayer player;
    private TextView status;
    private FamilyPlaybackLeaseGate.Permit permit;
    private Runnable expiry;
    private String videoId;
    private void note(String text){if(!destroyed)status.setText(text);}
    private void stopPlayback(){
        if(expiry!=null){main.removeCallbacks(expiry);expiry=null;}
        if(gate!=null)gate.invalidate();
        permit=null;
        if(player!=null){player.stop();player.release();player=null;}
    }
    private String extractApprovedSource(String id) throws Exception {
        NewPipe.init(new ExtractorDownloader(true));
        StreamExtractor extractor=ServiceList.YouTube.getStreamExtractor(
                "https://www.youtube.com/watch?v="+id);
        extractor.fetchPage();
        if(!id.equals(extractor.getId())||extractor.getAgeLimit()>0)
            throw new IOException("VIDEO_UNAVAILABLE");
        for(VideoStream stream:extractor.getVideoStreams()){
            if(stream.isUrl()&&!stream.isVideoOnly()&&
                stream.getFormat()==MediaFormat.MPEG_4&&
                stream.getDeliveryMethod()==DeliveryMethod.PROGRESSIVE_HTTP&&
                ApprovalPolicy.safeMedia(stream.getContent()))
                return stream.getContent();
        }
        throw new IOException("NO_SUPPORTED_STREAM");
    }
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);
        if((getApplicationInfo().flags &
            android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)==0){finish();return;}
        videoId=getIntent().getStringExtra("videoId");
        if(videoId==null||!ApprovalPolicy.VIDEO.matcher(videoId).matches()){finish();return;}
        LinearLayout root=new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        root.setPadding(12,24,12,12);
        root.setBackgroundColor(Color.rgb(16,17,29));
        status=new TextView(this);
        status.setTextColor(Color.WHITE);
        status.setTextSize(17);
        status.setText("ניסוי ניגון Media3: בדיקת הרשאות לפני הכנת המדיה.");
        root.addView(status);
        PlayerView view=new PlayerView(this);
        root.addView(view,new LinearLayout.LayoutParams(-1,0,1));
        // Disable player UI controls: pause/resume cannot bypass our guard.
        view.setUseController(false);
        Button stop=new Button(this);stop.setText("עצירת הבדיקה וסגירה");
        stop.setOnClickListener(v->{stopPlayback();finish();});
        root.addView(stop);
        setContentView(root);
        worker.execute(()->{
            try {
                FamilySessionStore store=new FamilySessionStore(getApplicationContext());
                String saved=store.load();
                if(saved==null)throw new IOException("NO_PAIRED_DEVICE");
                okhttp3.OkHttpClient http=new okhttp3.OkHttpClient.Builder()
                    .connectTimeout(15,java.util.concurrent.TimeUnit.SECONDS)
                    .readTimeout(20,java.util.concurrent.TimeUnit.SECONDS)
                    .callTimeout(35,java.util.concurrent.TimeUnit.SECONDS)
                    .retryOnConnectionFailure(false).build();
                FamilyAuthClient auth=new FamilyAuthClient(http);
                FamilyAuthClient.Session session=auth.refresh(saved);
                store.save(session.refreshToken);
                // Extraction is untrusted and never authorizes a media item.
                String url=extractApprovedSource(videoId);
                // Crucially, refresh family authorization AFTER extraction.
                FamilyPlaybackGuard guard=new FamilyPlaybackGuard(auth);
                gate=new FamilyPlaybackLeaseGate(id->
                    guard.authorizeVideo(session.accessToken,id));
                FamilyPlaybackLeaseGate.Permit checked=gate.request(videoId);
                main.post(()->{
                    if(destroyed||!visible){gate.invalidate();return;}
                    try{
                        gate.requireAuthorized(checked,videoId);
                        if(!ApprovalPolicy.safeMedia(url))
                            throw new IOException("UNSAFE_MEDIA_HOST");
                        player=new ExoPlayer.Builder(this).build();
                        view.setPlayer(player);
                        permit=checked;
                        player.addListener(new Player.Listener(){
                            @Override public void onPlayerError(PlaybackException error){
                                if(destroyed)return;
                                String kind="PLAYBACK_ERROR";
                                for(Throwable cause=error;cause!=null;cause=cause.getCause()){
                                    if(cause instanceof HttpDataSource.InvalidResponseCodeException){
                                        kind="HTTP_"+((HttpDataSource.InvalidResponseCodeException)cause).responseCode;
                                        break;
                                    }
                                }
                                note("הניגון נכשל: "+kind+" (ללא חשיפת כתובת המדיה).");
                                stopPlayback();
                            }
                        });
                        player.setMediaItem(MediaItem.fromUri(url));
                        gate.requireAuthorized(permit,videoId);
                        player.prepare();
                        gate.requireAuthorized(permit,videoId);
                        player.play();
                        note("ניסוי ניגון פעיל עד 5 שניות בלבד; הנגן הרגיל לא השתנה.");
                        long remaining=Math.max(0,checked.expiresAt-System.currentTimeMillis());
                        expiry=()->{stopPlayback();note("הבדיקה הסתיימה; ההרשאה הזמנית פגה.");};
                        main.postDelayed(expiry,remaining);
                    }catch(Exception error){
                        stopPlayback();note("הבדיקה נחסמה: "+error.getClass().getSimpleName());
                    }
                });
            }catch(Exception error){
                final String result=error instanceof IOException?error.getMessage():"UNAVAILABLE";
                main.post(()->note("לא ניתן להתחיל בדיקה: "+result));
            }
        });
    }
    @Override protected void onStart(){super.onStart();visible=true;}
    @Override protected void onStop(){visible=false;stopPlayback();super.onStop();}
    @Override protected void onDestroy(){
        destroyed=true;stopPlayback();worker.shutdownNow();super.onDestroy();
    }
}
