// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.widget.*;
import java.util.concurrent.*;
import java.io.IOException;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import org.json.JSONObject;

/**
 * Pilot-only family pairing. It does not switch the production playback/approval source.
 * No token is displayed or logged. Network operations never run on the UI thread.
 */
public final class FamilyPairingActivity extends Activity {
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final Handler main=new Handler(Looper.getMainLooper());
    private volatile boolean destroyed;
    private EditText codeInput,nameInput;
    private Button pairButton,verifyButton,catalogButton,videoCheckButton;
    private TextView message;
    private FamilySessionStore store;
    private FamilyAuthClient auth;
    private FamilyPairingClient pairing;
    interface Job {String run() throws Exception;}
    private int dp(int size){return Math.round(getResources().getDisplayMetrics().density*size);}
    private void run(Job job) {
        pairButton.setEnabled(false);verifyButton.setEnabled(false);catalogButton.setEnabled(false);videoCheckButton.setEnabled(false);
        message.setText("מתבצעת בדיקה מול השרת…");
        worker.execute(()->{
            String result;
            try{result=job.run();}
            catch(Exception error){
                String reason=error instanceof IOException?error.getMessage():"UNAVAILABLE";
                result="הפעולה לא הושלמה ("+reason+"). אין שינוי בנגן הקיים.";
            }
            final String text=result;
            main.post(()->{if(!destroyed){message.setText(text);pairButton.setEnabled(true);verifyButton.setEnabled(true);catalogButton.setEnabled(true);videoCheckButton.setEnabled(true);}});
        });
    }
    private EditText input(String hint){
        EditText field=new EditText(this);
        field.setHint(hint);field.setSingleLine(true);
        field.setTextColor(Color.WHITE);field.setHintTextColor(Color.LTGRAY);
        return field;
    }
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        store=new FamilySessionStore(this);
        OkHttpClient client=new OkHttpClient.Builder()
                .connectTimeout(15,TimeUnit.SECONDS).readTimeout(20,TimeUnit.SECONDS)
                .callTimeout(35,TimeUnit.SECONDS).retryOnConnectionFailure(false).build();
        auth=new FamilyAuthClient(client);
        pairing=new FamilyPairingClient(client);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        root.setPadding(dp(18),dp(30),dp(18),dp(20));root.setBackgroundColor(Color.rgb(26,26,46));
        TextView title=new TextView(this);title.setText("שיוך מכשיר למשפחה — פיילוט");
        title.setTextSize(23);title.setTextColor(Color.WHITE);title.setGravity(Gravity.CENTER);
        root.addView(title);
        TextView warning=new TextView(this);
        warning.setText("זהו ניסוי נפרד. עד להפעלת מצב משפחתי מאומת, הצפייה באפליקציה ממשיכה להשתמש ברשימה הרגילה. יש להשתמש רק בקוד שההורה יצר.");
        warning.setTextColor(Color.rgb(255,225,166));warning.setTextSize(15);
        warning.setPadding(0,dp(18),0,dp(18));root.addView(warning);
        codeInput=input("קוד שיוך בן 16 תווים");codeInput.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        root.addView(codeInput);
        nameInput=input("שם המכשיר שיופיע אצל ההורה");root.addView(nameInput);
        pairButton=new Button(this);pairButton.setText("שיוך מכשיר");root.addView(pairButton);
        verifyButton=new Button(this);verifyButton.setText("בדיקת שיוך קיים");root.addView(verifyButton);
        catalogButton=new Button(this);catalogButton.setText("בדיקת סרטונים מאושרים למשפחה");
        root.addView(catalogButton);
        EditText videoIdInput=input("מזהה סרטון YouTube לבדיקה (11 תווים)");root.addView(videoIdInput);
        videoCheckButton=new Button(this);videoCheckButton.setText("בדיקת הרשאה לסרטון (ללא ניגון)");root.addView(videoCheckButton);
        message=new TextView(this);message.setTextColor(Color.WHITE);message.setTextSize(16);
        message.setPadding(0,dp(20),0,0);message.setText("יש להזין קוד שההורה יצר באתר המשפחות.");
        root.addView(message);
        ScrollView scroll=new ScrollView(this);scroll.addView(root);
        setContentView(scroll);
        pairButton.setOnClickListener(v->{
            final String code=codeInput.getText().toString().trim();
            final String name=nameInput.getText().toString().trim();
            try{FamilyPairingClient.validate(code,name);}
            catch(IllegalArgumentException invalid){message.setText("יש להזין קוד תקין ושם מכשיר.");return;}
            run(()->{
                String saved=store.load();
                FamilyAuthClient.Session session;
                if(saved!=null){
                    session=auth.refresh(saved);
                    // Rotation must be durable before any further network operation.
                    store.save(session.refreshToken);
                    try{
                        JSONObject existing=auth.list(session.accessToken);
                        if(FamilyApprovalSnapshot.fromAuthorizedResponse(existing).version>=1)
                            return "המכשיר כבר משויך למשפחה. אין צורך בקוד נוסף.";
                        throw new IOException("INVALID_FAMILY_LIST");
                    }catch(IOException prior){
                        // Only an explicitly unbound/revoked device may attempt pairing.
                        // A revoked device is always refused again by the server.
                        if(!"FAMILY_HTTP_403".equals(prior.getMessage()))
                            throw prior;
                    }
                }else{
                    session=auth.createAnonymous();
                    // Persist BEFORE redeeming the one-time pairing code. If the
                    // process dies after the server commits, this identity survives.
                    store.save(session.refreshToken);
                }
                pairing.pair(session.accessToken,code,name);
                try{
                    JSONObject list=auth.list(session.accessToken);
                    FamilyApprovalSnapshot.fromAuthorizedResponse(list);
                    return "המכשיר שויך למשפחה בהצלחה. מצב הצפייה המשפחתי עדיין לא מופעל.";
                }catch(IOException verification){
                    return "השיוך נרשם, אך בדיקת הרשימה נכשלה ("+verification.getMessage()+"). אפשר לבדוק שוב.";
                }
            });
        });
        verifyButton.setOnClickListener(v->run(()->{
            String saved=store.load();
            if(saved==null)return "אין התחברות שמורה. יש לקבל קוד חדש מההורה.";
            FamilyAuthClient.Session session=auth.refresh(saved);
            // A refresh token can rotate. Save the replacement before any list check.
            store.save(session.refreshToken);
            JSONObject list=auth.list(session.accessToken);
            if(!list.has("list")||!list.has("version"))throw new IOException("INVALID_FAMILY_LIST");
            return "השיוך מאומת. הרשימה המשפחתית נגישה, אך הנגן הקיים עדיין לא הועבר אליה.";
        }));
        videoCheckButton.setOnClickListener(v->{
            final String videoId=videoIdInput.getText().toString().trim();
            run(()->{
                String saved=store.load();
                if(saved==null)return "אין שיוך שמור. יש לשייך את המכשיר תחילה.";
                FamilyAuthClient.Session session=auth.refresh(saved);
                store.save(session.refreshToken);
                new FamilyPlaybackGuard(auth).authorizeVideo(session.accessToken,videoId);
                return "הרשאת צפייה לסרטון אומתה למשפחה זו. הנגן טרם הופעל.";
            });
        });
        catalogButton.setOnClickListener(v->run(()->{
            String saved=store.load();
            if(saved==null)return "אין שיוך שמור. יש לשייך את המכשיר תחילה.";
            FamilyAuthClient.Session session=auth.refresh(saved);
            // Persist refresh rotation first; never read the legacy grants.
            store.save(session.refreshToken);
            FamilyApprovalSnapshot grants=FamilyApprovalSnapshot.fromDevicePlaybackGrants(
                    auth.playbackGrants(session.accessToken));
            FamilyVideoCatalog catalog=FamilyVideoCatalog.fromServer(
                    auth.catalogIds(session.accessToken));
            catalog.assertMatches(grants);
            return "בדיקת אישורים משפחתיים הצליחה. ברשימה "+catalog.videoIds.size()+
                    " סרטונים שאושרו ישירות. צפייה משפחתית טרם הופעלה.";
        }));
    }
    @Override protected void onDestroy(){destroyed=true;worker.shutdownNow();super.onDestroy();}
}
