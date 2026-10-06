# Kids YouTube — Android/NewPipe proof

This is an isolated Android application that displays the existing Hebrew RTL UI.
The deployed GitHub Pages website is unchanged.

- Three existing tabs, local search, lazy thumbnails, ID deduplication.
- Parent still edits the SAME videos.txt on main; no server, account, API key or payment.
- Real NewPipeExtractor v0.26.5 dependency executes on the Android device.
- Native AndroidX Media3 player, up to two combined MP4 formats and one joined
  video/audio alternative, maximum 720p, no autoplay chain.
- Bounded requests, per-request cancellation, generation guard, finite media
  attempts and cooldown after explicit upstream blocking.
- Whitelist authorization is repeated in Java. Display caches and JS are not grants.
- Only packaged main-frame JS can call WebMessageListener. No JS interface on
  untrusted frames, external browser intents, arbitrary URLs or WebView embeds.
- Requires Android 6 (API 23) or newer plus an updated Android System WebView.

## Build

Android builds require the Android SDK, JDK 17, Node and Gradle 8.13:
    cd android
    gradle :app:testDebugUnitTest :app:assembleDebug

CI installs these automatically; no build step has been introduced for the website.
The APK is in app/build/outputs/apk/debug/app-debug.apk. Source is public and GPL-3.0-or-later.
prepare-assets.cjs copies the current website and applies checked integration anchors;
it fails instead of silently packaging an incompatible future UI.

## Install the test APK

Open this branch's successful Android Actions run, download the
kids-youtube-newpipe-proof artifact, unzip, and install app-debug.apk.
Android may ask you to allow installing this file from the download app.
The app label includes “בדיקה” and application ID is il.kidsyoutube.proof, so it
does not replace another installed application. No Google Play account is required.

This is a debug-signed proof build; future CI builds can have a different debug
signature and need uninstall/reinstall. It is not a production update-signing setup.

## What still needs a real device

Compilation, unit tests and fake bridge responses do NOT prove real YouTube playback.
The previous cloud probe was blocked by YouTube. This Android path has no browser
CORS restriction but can still receive authorization/bot/rate-limit errors.

On the target tablet:
1. Confirm the manually approved mVTlbvQ_010 card still shows when metadata fails.
2. Confirm actual moving video AND audible sound for that video.
3. Browse meirshows, play one of its videos, confirm all three tabs and deduplication.
4. Close while connecting, reopen another video; no old playback should start.
5. Test offline/online and removing a video/channel from videos.txt.
6. Test end of video (no next video), pause, rotate, Home/Back, app resume.
7. A source-format fallback can only be verified using a failing available format;
   an authorization block stops attempts and is not bypassed.

A failure displays a friendly Hebrew message. Do not claim all devices or videos
work until these checks are completed on a real Android device.
