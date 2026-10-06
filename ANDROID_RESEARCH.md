# Player integration research — 2026-10-06

## Decision

Use **NewPipeExtractor v0.26.5 in an Android application** that displays the existing
website UI. The parent explicitly accepted this form of integration in chat.
This is an isolated proof branch, not a replacement of the deployed PWA.

There is no comparable published success-rate/uptime dataset for these clients.
Issue counts, stars and a successful compile do not establish “fewest failures”.
The selection is based on architectural fit, maintained releases and source API,
not a claimed reliability ranking.

| Project | Current evidence | Fit for this project |
|---|---|---|
| NewPipe | v0.29.1 released Aug 15; latest extractor v0.26.5. Recent video HTTP 403 reports still exist. | Native independent JVM extractor; network can run on the tablet without a server. Selected for a device proof. |
| FreeTube | v0.25.3-beta Aug 28 fixes playback; release notes still mention CAPTCHA HTML; platform-specific playback regressions remain reported. | Desktop Electron client, not a drop-in browser library. |
| FreeTubeAndroid | v0.25.3.1 Sep 13; README says APK has local extraction, PWA only Invidious. | Confirms native/PWA distinction. No entire fork or spoofing/challenge code copied. |
| Piped | Uses Java NewPipeExtractor backend plus proxy. Public-instance failures reported; not evidence of a reliable free service. | Requires a backend; not a drop-in static Pages solution. |
| Invidious | Backend application with Companion; depends on server availability and YouTube upstream. | Current cloud/public provider failures remain unresolved. |
| youtubei.js | Library works in Node/Deno/browser environments; browser examples need a proxy for data/media and are marked potentially outdated. | A library alone does not remove browser CORS or an upstream authorization block. The existing cloud proof was blocked. |

## Primary sources checked

- https://github.com/TeamNewPipe/NewPipe/releases/tag/v0.29.1
- https://github.com/TeamNewPipe/NewPipeExtractor/releases/tag/v0.26.5
- https://github.com/TeamNewPipe/NewPipeExtractor/tree/v0.26.5
- https://github.com/TeamNewPipe/NewPipe/issues/13841 — recent HTTP 403 report; closed as duplicate, not proof fixed.
- https://github.com/TeamNewPipe/NewPipe/issues/13320 — earlier 360p/audio regression, later closed.
- https://github.com/FreeTubeApp/FreeTube/releases/tag/v0.25.3-beta
- https://github.com/FreeTubeApp/FreeTube/issues/9526 — playback/SABR fixes.
- https://github.com/FreeTubeApp/FreeTube/issues/9823 — open platform-specific failure as of research.
- https://github.com/FreeTubeApp/FreeTube/wiki/Local-API
- https://github.com/FreeTubeAndroid/FreeTubeAndroid
- https://github.com/TeamPiped/Piped-Backend
- https://docs.invidious.io/installation/
- https://ytjs.dev/guide/browser
- https://developer.android.com/jetpack/androidx/releases/media3
- https://developer.android.com/reference/androidx/webkit/WebViewCompat.WebMessageListener

## What code is integrated

android/app/build.gradle depends on the real pinned NewPipeExtractor artifact.
NativeApi calls the actual StreamExtractor, ChannelInfo and ChannelTabInfo APIs.
It translates those results into the small metadata contract already consumed
by app.js. Media3 1.11.1 plays approved direct MP4 or separate MP4/M4A tracks.

No public Invidious requests are made by the Android metadata/player path.
Thumbnails still use the same YouTube image CDN. videos.txt still lives in the same
GitHub repository on main. No service was created, payment added or existing cloud
service changed.

The existing website files are unmodified. A checked packaging script copies the
UI for Android and injects a main-frame-only native adapter. The application has a
separate proof package ID and clearly marked test label.

## Verification boundary

CI checks website regressions, native bridge cancellation/timeout and authorization,
compiles against the real library, runs Java unit tests and produces an APK.
This does **not** verify playback on the tablet or justify saying all formats work.
The previous cloud probe received an explicit YouTube verification/login block;
this branch does not retry that cloud probe, implement a solver, rotate networks,
or add a PoToken provider.

A native device does not impose browser CORS on Java network calls. That removes
one architectural failure mode, but YouTube can still reject extraction/media.
Confirm real moving video and sound on the target device before replacing anything
in production. The complete device checklist is in android/README.md.
