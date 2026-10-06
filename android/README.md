# פתיחת הפרויקט ב־Android Studio

כל הפרויקט נמצא בריפו **yt2178/kids-youtube**, והפרויקט של אפליקציית הילדים בתיקיית **android**.

1. הורידו את **Kids-YouTube-AndroidStudio.zip** מה־[Releases](https://github.com/yt2178/kids-youtube/releases), או GitHub → Code → Download ZIP.
2. חלצו את **כל** הקובץ. אין להוריד רק את תיקיית android — היא משתמשת בממשק ובאייקונים שנמצאים לידה בריפו.
3. ב־Android Studio בחרו **Open** ופתחו את תיקיית **android** בתוך התיקייה שחילצתם.
4. המתינו ל־Gradle Sync. אם Studio מציע התקנת SDK, אשרו התקנת Android SDK 36 וכלי בנייה 35.0.0. השתמשו ב־Gradle JDK 17 או ב־JDK תואם של Studio.
5. בחרו **app**, חברו מכשיר Android ולחצו ▶ Run.

לא צריך להתקין Node, framework, שרת, מסד נתונים או Gradle בנפרד. Gradle Wrapper הרשמי נמצא בריפו, עם בדיקת SHA-256 להפצה. בהורדה ובבנייה הראשונות נדרש אינטרנט כדי להביא את SDK והתלויות. האתר הסטטי עדיין אינו דורש build.

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
└── videos.txt              ← הרשימה המשותפת
```

מודול parent מהניסוי הקודם נשמר בקוד אך אינו נפתח כברירת מחדל ואינו נדרש להורה. למפתח בלבד: `-PincludeParentCompanion=true`.

נגן NewPipeExtractor/Media3 המקורי נשמר; נעשו התאמות UI לאזורי מערכת, מקלדת, טקסט מוגדל ומסכים נמוכים. הממשק כולל שלושה טאבים, חיפוש מקומי, thumbnails עצלים ועמודים. אין נגן YouTube חיצוני, שיתוף או רצף ניגון באפליקציית הילדים.

דורש **Android 6 ומעלה** ו־WebView מעודכן. התאמה לגדלי מסך אינה הבטחה לכל גרסת Android ישנה. אין יעד iOS בפרויקט.

## בנייה ובדיקות

```bash
cd android
./gradlew :app:testDebugUnitTest :app:assembleDebug
```

ב־Windows משתמשים ב־`gradlew.bat`. ה־APK נמצא ב־`app/build/outputs/apk/debug/app-debug.apk`.

CI בונה עם Wrapper את הפרויקט המוגדר כברירת מחדל, בודק שאריזת הממשק ב־Gradle זהה לאריזה שנבדקה ב־Node, ובודק גם את קוד ההורה הקודם. Node נדרש רק למפתח שמריץ את בדיקות האתר, לא לפתיחת הפרויקט ובנייתו ב־Studio.

קובץ ה־ZIP בפרסום נוצר מתוך ה־commit המדויק שנבנה ונבדק. קובצי APK לבטא חתומים ב־debug; חתימה יכולה להשתנות בבנייה הבאה ולחייב הסרה/התקנה מחדש. עדכונים רציפים דורשים מפתח חתימה פרטי קבוע מחוץ לריפו הציבורי.

השיתוף/האישור בדפדפן, המקלדת, rotation וניגון בגרסה החדשה צריכים גם בדיקה במכשיר אמיתי. המשתמש דיווח שהנגן המקורי עובד במכשיר שלו; זו אינה בדיקה פיזית עצמאית שלנו.
