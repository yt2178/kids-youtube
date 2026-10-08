> **התקנה ועדכון:** משכו את main באמצעות `git pull`, פתחו את תיקיית `android` ב־Android Studio והפעילו Run. אין עוד הפצת APK/ZIP, Releases או תגי family-beta אוטומטיים. אתר GitHub Pages מיועד להורים בלבד; קטלוג הילדים זמין באפליקציית Android.\n\n# פתיחת הפרויקט ב־Android Studio

כל הפרויקט נמצא בריפו **yt2178/kids-youtube**, והפרויקט של אפליקציית הילדים בתיקיית **android**.

1. בתיקיית הפרויקט הקיימת הריצו `git pull`.
2. ב־Android Studio בחרו **Open** ופתחו את `kids-youtube-full/android`.
3. המתינו ל־Gradle Sync. במידת הצורך התקינו Android SDK 36 וכלי בנייה 35.0.0.
4. בחרו **app**, חברו את המכשיר ולחצו ▶ Run.

לא צריך להתקין Node, framework, שרת, מסד נתונים או Gradle בנפרד. Gradle Wrapper הרשמי נמצא בריפו. בהורדה ובבנייה הראשונות נדרש אינטרנט כדי להביא את SDK והתלויות. האתר הסטטי עדיין אינו דורש build.

## מבנה

```text
kids-youtube/
├── android/
│   ├── settings.gradle
│   ├── build.gradle
│   ├── gradlew / gradlew.bat
│   ├── gradle/wrapper/
│   ├── prepare-assets.gradle
│   └── app/                 ← אפליקציית הילדים
├── index.html / app.js      ← מסך הילדים המשותף
├── icons/
├── parents.html            ← עמוד ההורים, ללא התקנה
└── videos.txt              ← קובץ תאימות היסטורי בלבד; אינו מקור ההרשאה הפעיל
```

מודול parent מהניסוי הקודם נשמר בקוד לצורכי נסיגה בלבד, אינו נפתח כברירת מחדל ואינו משנה את הרשאות Supabase הפעילות. למפתח בלבד: `-PincludeParentCompanion=true`.

נגן NewPipeExtractor/Media3 המקורי נשמר; נעשו התאמות UI לאזורי מערכת, מקלדת, טקסט מוגדל ומסכים נמוכים. הממשק כולל שלושה טאבים, חיפוש מקומי, thumbnails עצלים ועמודים. אין נגן YouTube חיצוני, שיתוף או רצף ניגון באפליקציית הילדים.

דורש **Android 6 ומעלה** ו־WebView מעודכן. התאמה לגדלי מסך אינה הבטחה לכל גרסת Android ישנה. אין יעד iOS בפרויקט.

## בנייה ובדיקות

```bash
cd android
./gradlew :app:testDebugUnitTest :app:assembleDebug
```

ב־Windows משתמשים ב־`gradlew.bat`. ה־APK נמצא ב־`app/build/outputs/apk/debug/app-debug.apk`.

CI בונה עם Wrapper את הפרויקט המוגדר כברירת מחדל, בודק שאריזת הממשק ב־Gradle זהה לאריזה שנבדקה ב־Node, ובודק גם את קוד ההורה הקודם. Node נדרש רק למפתח שמריץ את בדיקות האתר, לא לפתיחת הפרויקט ובנייתו ב־Studio.

הבנייה המקומית ב־Android Studio מתבצעת מול הקוד שהורדתם ב־Git. מספר ה־commit מוטמע בגרסת debug כאשר Git זמין. אין פרסום APK או ZIP אוטומטי ב־CI.

השיתוף/האישור בדפדפן, המקלדת, rotation וניגון בגרסה החדשה צריכים גם בדיקה במכשיר אמיתי. המשתמש דיווח שהנגן המקורי עובד במכשיר שלו; זו אינה בדיקה פיזית עצמאית שלנו.
