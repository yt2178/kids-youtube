# מחקר מסלול ניגון — 2026-10-06

## מצב הפרויקט שממנו ממשיכים

נקודת המוצא: main ב־15f1f7fca0701bcda3f45dcf9d134536098adc73. קוד JS בגרסה 20261006h, Service Worker shell v11. ביומן GitHub Actions של ריצה 37402212873 אומתו 122 בדיקות, 122 הצלחות, 0 כישלונות. גם אריזת האתר הסטטי והפריסה הסתיימו בהצלחה. זהו אימות של הריצה הקיימת, ולא הרצת בדיקות מקומית חדשה.

הבעיה הפתוחה נשארה: לא הוכח ניגון מוצלח בגרסה הנוכחית. בבדיקות הדפדפן האחרונות שתועדו ב־AUDIT.md, tiekoetter הציג דף שגיאה ו־chocolatemoo סירב להטמעה. f5 כבר הציג חסימת bot ולכן לא נבדק שוב. fallback מ־native ל־embed ומעבר בין מקורות נצפו, אבל אינם הוכחת צפייה. מידע ידני נותר מוצג בלי API; מידע ערוץ שמור אינו הוכחת שיוך עדכנית להפעלה.

בעת המחקר הזה סביבת העבודה והדפדפן אינם זמינים. לכן לא בוצעו ניגון חי נוסף, בדיקת Android, בדיקת Console/Network חדשה או ניסוי ביצועים בספריות שנבדקו. הקובץ הוא מחקר התאמה, לא מימוש חדש.

## כיצד הפרויקטים עובדים

| פרויקט | מנגנון | התאמה לאתר שלנו |
| --- | --- | --- |
| FreeTube | תוכנת Desktop עם extractor מקומי, או API של Invidious. המנגנון המקומי משתמש בין היתר ב־youtubei.js וב־googlevideo, ויכול לשמש fallback מ־Invidious. | מנגנון חילוץ במכשיר אינו ניתן להעתקה כמות שהוא לדף GitHub Pages. יכול לשמש מקור לתכנון normalization ו־fallback. |
| NewPipe | אפליקציה שמנתחת מידע מהשירות או משתמשת ב־API הפנימי שלו; NewPipeExtractor הוא רכיב חילוץ נפרד שניתן להשתמש בו גם בנפרד. | הרכיב מופץ עבור סביבת Gradle/Maven ואפליקציות. אינו ספריית JavaScript שמטמיעים בדף HTML; שילובו אצלנו ידרוש סביבת שרת מתאימה או אפליקציה מקומית. |
| Piped | אתר עם backend המבוסס על NewPipeExtractor ו־proxy להעברת תוכן. | אפשר לבנות מתאם ל־API שלו, אך עדיין נדרש backend/proxy זמין. מופע ציבורי נוסף אינו הוכחה ליציבות. |
| Invidious | מערכת שרת עם API וממשק; רכיב Companion משיג את הזרמים ומבוסס על YouTube.js. ההתקנה כוללת גם PostgreSQL. | כבר בשימוש באתר. התקנה משלנו נותנת שליטה בשרת וב־CORS אך אינה מבטיחה זמינות YouTube. מערכת מלאה אינה רצה ב־GitHub Pages. |
| youtubei.js / YouTube.js | ספריית JavaScript ל־InnerTube, ה־API הפנימי של YouTube; רצה בכמה סביבות, כולל דפדפנים. | מתאימה טכנית לניסוי בחילוץ metadata וזרמים, אבל תיעוד הדפדפן דורש proxy משלנו לבקשות ולניגון. JavaScript לבדו אינו מבטל CORS. |

מקורות:
- FreeTube: https://docs.freetubeapp.io/about/freetube , https://docs.freetubeapp.io/usage/local-api/
- NewPipe: https://github.com/TeamNewPipe/NewPipe , https://github.com/TeamNewPipe/NewPipeExtractor
- Piped: https://github.com/TeamPiped/Piped-Backend , https://docs.piped.video/docs/self-hosting/
- Invidious: https://docs.invidious.io/installation/ , https://github.com/iv-org/invidious-companion
- YouTube.js: https://github.com/LuanRT/YouTube.js , https://ytjs.dev/guide/browser-usage

ההוראות בעמוד Browser Usage של YouTube.js מסמנות את דוגמת הקוד כישנה ומפנות לדוגמאות חדשות. לא הועתק הקוד הישן כהמלצת production. דוגמת SABR העדכנית לא נפתחה בכלי המחקר; אין טענה שנבדקה או ש־MP4 יחיד מתאים לכל סרטון כיום.

## המשמעות ל־fallback

חמשת השמות אינם חמישה מנועי חילוץ עצמאיים: FreeTube ו־Invidious Companion משתמשים ב־YouTube.js; Piped משתמש ב־NewPipeExtractor. זו תלות משותפת מתועדת. מכאן ההסקה ההנדסית: תקלה במנוע משותף או שינוי מצד YouTube עשויים להשפיע על כמה מסלולים יחד. החלפת frontend או הוספת כתובות אינה יוצרת בהכרח גיבוי עצמאי.

מקור: https://docs.freetubeapp.io/usage/local-api/ , https://github.com/iv-org/invidious-companion , https://github.com/TeamPiped/Piped-Backend .

## מה אפשר באתר הנוכחי

GitHub Pages מארח קבצים סטטיים; אינו מריץ backend בזמן בקשת ילד. לכן Piped/Invidious self-hosted או שרת חילוץ ל־youtubei.js אינם יכולים לרוץ בו עצמו. אפשר להשאיר את כל ממשק הילדים, שלושת הטאבים, האישורים וה־PWA בו, ולהשתמש בשירות חיצוני נפרד אם ייבחר שינוי ארכיטקטורה בעתיד.

מקור: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages .

במסגרת GitHub Pages בלבד אפשר להשתמש ב־API או embed של ספק שמרשה את הגישה, עם timeout ומטמון והודעות ידידותיות. אין במקורות שנבדקו פתרון מוכח שמבטיח ניגון YouTube ללא פרסומות, בלי שרת/ספק חיצוני זמין, בדפדפן רגיל. אין להסיק שחבילת youtubei.js בדף מספיקה. קישורי מדיה שנאספו בסקריפט חד־פעמי אינם תחליף להוכחת ניגון בזמן הבקשה; פתרון כזה לא נבדק כאן.

אפשרות Piped כמתאם נוסף דורשת הוכחת CORS, פעולת API, מדיה אמיתית, timeout, ביטול ניסיונות ואימות channelId. לא הוכחה זמינות של מופע Piped ולא נוסף מתאם לקוד.

## כיוון לבדיקה עתידית אם ייבחר backend

המועמד הטכני לניסוי ממוקד הוא שירות חילוץ המבוסס על YouTube.js עם נגן בשליטתנו באתר, במקום להציג דף ספק בתוך iframe. זהו כיוון לניסוי, לא בחירה שהוכחה יציבה יותר. שירות כזה יכול להסדיר CORS ולהחזיר שגיאות מוגדרות; proxy שמתווך רק למופע Invidious שכבר נכשל לא מתקן את תקלת המקור.

לפני מימוש יש להוכיח:
1. metadata וזרם של סרטון ידני ושל סרטון ערוץ מאושר.
2. ניגון אמיתי עם זמן שמתקדם, גם אחרי מעבר בין סרטונים.
3. צורת הזרם הדרושה — MP4 או DASH/HLS/SABR — והתאמתה לנגן ולמגבלות ה־frontend. ייתכן שתידרש ספריית ניגון; אין הבטחה להישאר ללא dependencies.
4. העברת המדיה בפועל, לא רק תשובת metadata עם URL.
5. timeout, cancellation, שגיאות, חיפוש בתוך whitelist בלבד וביטול אישורים.
6. שהשרת מקבל video ID מאושר בלבד, מאמת שיוך לערוץ כשצריך, ואינו proxy פתוח שמקבל URL שרירותי.
7. עלויות ותעבורה אצל ספק hosting מסוים לפני הבטחה שהמערכת חינמית.

שרת בשליטתנו מטפל במגבלות CORS וב־UI של שגיאות, אך אינו מבטל חסימות YouTube או שינויים במנגנון החילוץ. גם FreeTube מתעד ששינויים באתר YouTube יכולים לשבור את המודולים שלו. יציבות תידרש להוכחה בניסוי ותחזוקה, ולא מובטחת בגלל בחירת ספרייה.

מקורות למגבלות: https://ytjs.dev/guide/browser-usage , https://docs.freetubeapp.io/usage/local-api/ , https://docs.invidious.io/instances/ .

## החלטה כרגע

לא נוספו backend, framework, database, חשבונות Google, API keys או ספק ציבורי נוסף. לא שונו קוד האתר ורשימת האישורים בעקבות המחקר. להמשך במסגרת GitHub Pages בלבד נשארת תלות בספק ניגון חיצוני זמין; זו עדיין הבעיה הפתוחה.
