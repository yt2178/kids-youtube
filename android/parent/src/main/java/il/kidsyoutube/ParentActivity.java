// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;
import android.app.*;
import android.content.*;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.*;
import android.text.InputType;
import android.view.*;
import android.widget.*;
import java.util.*;
import java.util.concurrent.*;
import okhttp3.*;
import org.json.*;

public final class ParentActivity extends Activity {
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private Future<?> task;
    private final ExecutorService images=Executors.newSingleThreadExecutor();
    private Future<?> imageTask;
    private volatile Call imageCall;
    private boolean isHome;
    private RequestScope scope;
    private long generation;
    private boolean saving,destroyed;
    private LinearLayout page;
    private TextView status;
    private TokenVault vault;
    private ParentMetadata metadata;
    private ParentMetadata.Preview preview;
    private EditText note;
    private String savedNote="";
    private final LinkedHashSet<String> pending=new LinkedHashSet<>();
    private String lastMessage="";
    private final List<Button> buttons=new ArrayList<>();
    private int listLimit=60;

    interface Work<T>{T get()throws Exception;}
    interface Done<T>{void accept(T result);}
    @Override public void onCreate(Bundle state){
        super.onCreate(state);vault=new TokenVault(this);metadata=new ParentMetadata();
        try {
            JSONArray rows=new JSONArray(getPreferences(0).getString("pending","[]"));
            for(int i=0;i<Math.min(rows.length(),50);i++)
                try{pending.add(ShareInput.parse(rows.getString(i)).url);}catch(Exception ignored){}
        }catch(Exception ignored){}
        if(!acceptShare(getIntent()))home();
    }
    @Override public void onNewIntent(Intent intent){
        super.onNewIntent(intent);setIntent(intent);
        if(!acceptShare(intent) && !saving)home();
    }
    private boolean acceptShare(Intent intent){
        if(intent==null || !Intent.ACTION_SEND.equals(intent.getAction()))return false;
        try {
            if(!"text/plain".equals(intent.getType()))throw new IllegalArgumentException();
            ApprovalPolicy.Link link=ShareInput.parse(intent.getStringExtra(Intent.EXTRA_TEXT));
            if(!pending.contains(link.url) && pending.size()>=50){lastMessage="יש כבר הרבה קישורים שממתינים. הוסיפו אותם לפני שיתוף נוסף.";return false;}
            pending.add(link.url);persistPending();
            if(saving){lastMessage="הקישור הנוסף מחכה לבדיקה.";return true;}
            inspect(link);return true;
        }catch(Exception ignored){lastMessage="שתפו קישור אחד של סרטון או ערוץ YouTube.";return false;}
    }
    private void persistPending(){getPreferences(0).edit().putString("pending",new JSONArray(pending).toString()).apply();}
    private int dp(int x){return Math.round(x*getResources().getDisplayMetrics().density);}
    private GradientDrawable background(int color,int radius){
        GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));return d;
    }
    private void screen(String heading){
        isHome=false; if(imageCall!=null)imageCall.cancel();if(imageTask!=null)imageTask.cancel(true);
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        buttons.clear();ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);
        page=new LinearLayout(this);page.setOrientation(LinearLayout.VERTICAL);page.setPadding(dp(22),dp(28),dp(22),dp(32));
        page.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);page.setFitsSystemWindows(true);
        page.setBackgroundColor(Color.rgb(26,26,46));
        scroll.addView(page);setContentView(scroll);label(heading,28,Color.WHITE);
        status=label("",17,Color.rgb(207,206,225));status.setMinHeight(dp(38));
    }
    private TextView label(String value,int size,int color){
        TextView text=new TextView(this);text.setText(value);text.setTextSize(size);text.setTextColor(color);
        text.setPadding(0,dp(8),0,dp(8));page.addView(text,new LinearLayout.LayoutParams(-1,-2));return text;
    }
    private Button button(String title,Runnable action){
        Button button=new Button(this);button.setText(title);button.setTextSize(18);button.setTextColor(Color.WHITE);
        button.setAllCaps(false);button.setMinHeight(dp(60));
        button.setBackground(background(Color.rgb(233,69,96),16));
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.setMargins(0,dp(8),0,dp(6));
        page.addView(button,p);button.setOnClickListener(v->action.run());buttons.add(button);return button;
    }
    private EditText input(String hint,boolean secret){
        EditText field=new EditText(this);field.setTextSize(18);field.setHint(hint);field.setTextColor(Color.WHITE);
        field.setHintTextColor(Color.LTGRAY);field.setMinHeight(dp(60));field.setPadding(dp(16),dp(12),dp(16),dp(12));
        field.setBackground(background(Color.rgb(38,38,62),14));
        if(secret){
            field.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);
            field.setSingleLine(true);
            if(Build.VERSION.SDK_INT>=26)field.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        }
        page.addView(field,new LinearLayout.LayoutParams(-1,-2));return field;
    }
    private <T> void run(String message,Work<T> work,Done<T> done){
        cancel();long id=++generation;
        RequestScope request=new RequestScope(25000);scope=request;
        status.setText(message);for(Button b:buttons)b.setEnabled(false);
        task=worker.submit(()->{
            request.enter();
            try {
                T result=work.get();request.check();
                main.post(()->{if(!destroyed && id==generation && !request.cancelled){
                    for(Button b:buttons)b.setEnabled(true);saving=false;done.accept(result);
                }});
            }catch(Exception e){
                main.post(()->{if(!destroyed && id==generation && !request.cancelled){
                    saving=false;for(Button b:buttons)b.setEnabled(true);status.setText(friendly(e));
                }});
            }finally{RequestScope.CURRENT.remove();}
        });
    }
    private void cancel(){
        if(scope!=null)scope.cancel();
        if(task!=null)task.cancel(true);
        if(imageCall!=null)imageCall.cancel();if(imageTask!=null)imageTask.cancel(true);
    }
    private String friendly(Exception e){
        if(e instanceof GithubListStore.Failure){
            int status=((GithubListStore.Failure)e).status;
            if(status==401 || status==403)return "החיבור ל־GitHub זקוק לבדיקה. פתחו ״חיבור הרשימה״ וחברו מחדש עם הרשאת כתיבה.";
            if(status==409)return "הרשימה עודכנה במכשיר אחר. נסו שוב; העדכון שלו נשמר.";
        }
        return "לא הצלחנו להשלים כרגע. הקישור נשמר כאן, ואפשר לנסות שוב עם חיבור לאינטרנט.";
    }
    private void home(){
        cancel();generation++;preview=null;savedNote="";saving=false;
        screen("הוספה לילדים");isHome=true;
        label("רואים משהו מתאים? ב־YouTube לוחצים ״שיתוף״ ובוחרים ״הוספה לילדים״.",20,Color.WHITE);
        label("בודקים את התמונה והשם, ואז מאשרים. סרטון הוא אישור בודד; ערוץ הוא אישור לכל התוכן שלו.",17,Color.LTGRAY);
        status.setText(lastMessage);
        button("＋ הדבקת קישור",this::paste);
        button("הרשימה המאושרת",this::showList);
        button(vault.read()==null?"חיבור הרשימה — פעם אחת":"חיבור הרשימה ✓",this::connect);
        if(!pending.isEmpty()){
            label("מחכים לבדיקה ("+pending.size()+")",20,Color.WHITE);
            for(String url:new ArrayList<>(pending)) {
                Button item=button(url,()->inspect(ShareInput.parse(url)));
                item.setTextSize(15);item.setTextDirection(View.TEXT_DIRECTION_LTR);
            }
        }
    }
    private void paste(){
        screen("הדבקת קישור");EditText link=input("קישור לסרטון או לערוץ",false);
        link.setTextDirection(View.TEXT_DIRECTION_LTR);
        button("זיהוי ובדיקה",()->{
            try{
                ApprovalPolicy.Link parsed=ShareInput.parse(link.getText().toString());
                if(!pending.contains(parsed.url) && pending.size()>=50)throw new IllegalArgumentException();
                pending.add(parsed.url);persistPending();inspect(parsed);
            }catch(Exception e){status.setText("הדביקו קישור אחד של סרטון או ערוץ YouTube.");}
        });
        button("חזרה",this::home);
    }
    private void inspect(ApprovalPolicy.Link link){
        preview=null;savedNote="";
        screen("בודקים לפני שמוסיפים");label("מזהים את הסרטון או הערוץ…",20,Color.WHITE);
        button("פתחו ב־YouTube לבדיקה",()->open(link.url));
        button("ביטול הקישור",()->{pending.remove(link.url);persistPending();home();});
        button("חזרה",this::home);
        run("טוענים את השם והתמונה…",()->metadata.load(link),result->{preview=result;showPreview();});
    }
    private void showPreview(){
        ParentMetadata.Preview current=preview;
        if(current==null){home();return;}
        screen(current.channel?"אישור ערוץ":"אישור סרטון");
        label(current.channel?"📺 ערוץ שלם":"▶ סרטון אחד",18,Color.rgb(255,175,190));
        ImageView image=new ImageView(this);image.setScaleType(ImageView.ScaleType.CENTER_CROP);
        image.setBackground(background(Color.rgb(44,43,67),18));
        page.addView(image,new LinearLayout.LayoutParams(-1,dp(190)));
        label(current.title,24,Color.WHITE);label(current.author,18,Color.LTGRAY);
        label("זה התוכן שרציתם להוסיף?",18,Color.WHITE);
        button("פתחו ב־YouTube לבדיקה",()->open(current.canonical));
        note=input("הערה להורה (לא חובה)",false);note.setText(savedNote);
        label("ההערה נשמרת בקובץ הציבורי ב־GitHub; הילדים לא רואים אותה במסך הצפייה.",14,Color.LTGRAY);
        button(current.channel?"אישור כל תוכן הערוץ":"כן, להוסיף לילדים",()->{
            savedNote=note.getText().toString();
            if(vault.read()==null){connect();return;}
            if(current.channel)new AlertDialog.Builder(this).setTitle("מאשרים את כל הערוץ?")
                .setMessage("כל הסרטונים בערוץ, וגם סרטונים חדשים שיועלו בעתיד, יהיו מותרים לילדים.")
                .setNegativeButton("חזרה לבדיקה",null).setPositiveButton("כן, אישור הערוץ",(d,w)->approve(current)).show();
            else approve(current);
        });
        button("לא להוסיף",()->{pending.remove(current.original.url);persistPending();home();});
        if(!current.thumbnail.isEmpty()){
            long id=generation;
            imageTask=images.submit(()->{
                try{
                    if(!ParentMetadata.safeImage(current.thumbnail))return;
                    okhttp3.Request req=new okhttp3.Request.Builder().url(current.thumbnail).build();
                    Call call=metadata.downloader.client.newCall(req);imageCall=call;
                    try(okhttp3.Response response=call.execute()){
                        if(!response.isSuccessful() || response.body()==null || response.body().contentLength()>2*1024*1024)return;
                        byte[] bytes=boundedBytes(response.body(),2*1024*1024);
                        BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;
                        BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);
                        if(options.outWidth<1 || options.outHeight<1 || options.outWidth>20000 || options.outHeight>20000)return;
                        options.inSampleSize=1;while(Math.max(options.outWidth,options.outHeight)/options.inSampleSize>1024)options.inSampleSize*=2;
                        options.inJustDecodeBounds=false;
                        Bitmap bitmap=BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);
                        main.post(()->{if(!destroyed && id==generation && preview==current)image.setImageBitmap(bitmap);});
                    }
                }catch(Exception ignored){}
            });
        }
    }
    private static byte[] boundedBytes(ResponseBody body,int limit) throws java.io.IOException {
        java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();
        try(java.io.InputStream input=body.byteStream()){byte[] chunk=new byte[8192];int n;while((n=input.read(chunk))!=-1){if(out.size()+n>limit)throw new java.io.IOException();out.write(chunk,0,n);}}
        return out.toByteArray();
    }
    private void approve(ParentMetadata.Preview current){
        saving=true;
        String token=vault.read(),comment=savedNote;
        run("מוסיפים לרשימה המשותפת…",()->new GithubListStore(token)
            .add(current.canonical,current.original.url,current.title,comment),added->{
                pending.remove(current.original.url);persistPending();
                lastMessage=added?"נוסף לילדים ✓ באפליקציית הילדים לחצו ״רענון הסרטונים״.":"התוכן הזה כבר נמצא ברשימה ✓";
                home();
            });
    }
    private void connect(){
        screen("חיבור הרשימה");getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        label("החיבור נעשה פעם אחת בטלפון ההורה. אחר כך מוסיפים ישירות ממסך השיתוף.",19,Color.WHITE);
        label("1. פתחו את GitHub והיכנסו לחשבון yt2178.\n2. בחרו Only select repositories ואז kids-youtube. ההרשאה Contents צריכה להיות Read and write.\n3. לחצו Generate token, העתיקו את המפתח והדביקו כאן.",17,Color.LTGRAY);
        button("פתיחת החיבור ב־GitHub",()->open("https://github.com/settings/personal-access-tokens/new?name=Kids+YouTube+Parent&target_name=yt2178&expires_in=90&contents=write"));
        label("חשבון GitHub אחר? קודם צריך הזמנה כ־collaborator. אם GitHub לא מאפשר הרשאה מוגבלת לריפו, אפשר ליצור classic token עם public_repo; הרשאה זו רחבה יותר לריפואים ציבוריים בחשבון.",15,Color.LTGRAY);
        button("חיבור לחשבון של ההורה השני",()->open("https://github.com/settings/tokens/new"));
        EditText token=input("הדבקת המפתח מ־GitHub",true);
        button("שמירת החיבור",()->{
            String value=token.getText().toString().trim();
            if(!value.matches("(github_pat_|gh[pou]_)\\S{20,1000}")){status.setText("הדביקו את המפתח שנוצר ב־GitHub.");return;}
            run("בודקים את החיבור…",()->{
                new GithubListStore(value).validateConnection();vault.save(value);return true;
            },ok->{token.setText("");lastMessage="החיבור נשמר בטלפון ✓";if(preview!=null)showPreview();else home();});
        });
        if(vault.read()!=null)button("ניתוק הטלפון מהרשימה",()->{vault.clear();lastMessage="החיבור הוסר מהטלפון.";home();});
        button("חזרה",()->{if(preview!=null)showPreview();else home();});
    }
    private void showList(){
        screen("הרשימה המאושרת");
        button("חזרה",this::home);
        String token=vault.read();if(token==null){status.setText("חברו את הטלפון כדי לנהל את הרשימה.");button("חיבור הרשימה",this::connect);return;}
        run("קוראים את הרשימה העדכנית…",()->new GithubListStore(token).read(),snapshot->renderList(snapshot.text));
    }
    private void renderList(String raw){
        screen("הרשימה המאושרת");button("חזרה",this::home);
        List<ListEditor.Entry> entries=ListEditor.entries(raw);
        status.setText(entries.size()+" אישורים ברשימה");
        for(ListEditor.Entry entry:entries.subList(0,Math.min(entries.size(),listLimit))){
            label((entry.link.videoId==null?"📺 ":"▶ ")+(entry.title.isEmpty()?entry.link.url:entry.title),18,Color.WHITE);
            button("ביטול אישור",()->new AlertDialog.Builder(this).setTitle("לבטל את האישור?")
                .setMessage(entry.link.videoId==null?"סרטוני הערוץ יוסרו, אלא אם אושרו בנפרד.":"אישור הסרטון יוסר. אם הערוץ שלו מאושר, הסרטון עדיין יהיה מותר.")
                .setNegativeButton("השארת האישור",null).setPositiveButton("ביטול",(dialog,which)->{
                    saving=true;
                    run("מבטלים את האישור…",()->{new GithubListStore(vault.read()).remove(entry.link.url);return true;},
                        ok->{lastMessage="האישור הוסר. רעננו את אפליקציית הילדים.";showList();});
                }).show());
        }
        if(entries.size()>listLimit)button("עוד אישורים",()->{listLimit+=60;renderList(raw);});
    }
    private void open(String url){
        try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)));}
        catch(ActivityNotFoundException e){status.setText("לא נמצא דפדפן לפתיחת הקישור.");}
    }
    @Override public void onBackPressed(){if(saving)return;if(isHome)super.onBackPressed();else home();}
    @Override protected void onDestroy(){
        destroyed=true;generation++;cancel();worker.shutdownNow();images.shutdownNow();metadata.downloader.client.dispatcher().cancelAll();
        super.onDestroy();
    }
}
