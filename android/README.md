# Kids YouTube — Android family beta

Two separate Android apps, both free and without a hosted backend:

- **app / il.kidsyoutube / סרטונים לילדים**: packaged Hebrew RTL three-tab UI and the original NewPipeExtractor 0.26.5 + AndroidX Media3 player. No parent account, token, link-entry form or sharing receiver. The original prototype's physical playback was reported successful by the user; this is not our independent device audit.
- **parent / il.kidsyoutube.parent / הוספה לילדים**: text/plain ACTION_SEND receiver and launcher. Classifies a single video/channel link with the same ApprovalPolicy, obtains an actual metadata preview through NewPipe, and requires explicit approval. Channels require a second all-content confirmation. Parents may open the canonical YouTube link to inspect before approval; children cannot do this. Pending links are local and are not approvals.

The parent app uses the GitHub Contents API, fixed to yt2178/kids-youtube/main/videos.txt. Each edit reads the latest SHA and reapplies the single operation after a conflict, at most three attempts. No whole-list overwrite based on an old local snapshot. Credentials are Android Keystore AES-GCM encrypted, backups disabled, never included in the child APK or website. HTTPS only; authenticated calls do not follow redirects. See [parent instructions](../PARENTS.md), including collaborator/token limitations.

The web UI is copied by prepare-assets.cjs, with checked integration anchors and a packaged-only native message adapter. Website source is preserved. SW registration and external frames are disabled in the packaged child UI. Only the packaged main frame may call WebMessageListener; untrusted frames cannot call native methods. Java repeats whitelist authorization; display caches and JS are not grants.

Player behavior remains unchanged: up to two combined MP4 formats and one joined video/audio alternative, maximum 720p, finite media attempts, request cancellation/generation guards, cooldown after explicit blocking, no next-video chain. It does not bypass YouTube verification/auth/rate-limit blocks. Requires Android 6+ and updated Android System WebView.

## Build and tests

JDK 17, Android SDK 36/build tools 35, Node, Gradle 8.13:

```bash
node --test tests/*.test.cjs
cd android
gradle :app:testDebugUnitTest :parent:testDebugUnitTest :app:assembleDebug :parent:assembleDebug
```

GitHub Actions installs the tools, runs all website/bridge and native tests, and builds both APKs. On main, a dependent publishing job uploads the exact tested APKs and SHA256 checksums to a commit-specific prerelease. Parent source filters reuse the unchanged downloader, RequestScope and ApprovalPolicy; no player/UI classes or JS bridge are included in the parent module.

APKs: app/build/outputs/apk/debug/app-debug.apk and parent/build/outputs/apk/debug/parent-debug.apk. Source is GPL-3.0-or-later. Dependencies and build requirements apply only to Android, not the static website.

## Install and limits

Use [Releases](https://github.com/yt2178/kids-youtube/releases), install Kids-YouTube.apk on the child tablet and Kids-YouTube-Parent.apk only on the parent phone. New child ID il.kidsyoutube installs alongside the earlier il.kidsyoutube.proof; the old signing key was not retained. Keep the working old app until you verify the new one.

Beta builds are debug-signed on an ephemeral CI runner. Later builds can require uninstall/reinstall (including reconnecting the parent); stable in-place updates need a persistent private signing key stored outside the public repository. No secret key was committed or public signing cache added.

## Physical acceptance still required

Automated tests cover actual parser/list/network code with fake upstream data; they do not prove physical sharing, Keystore persistence, or every YouTube stream. On the target phone/tablet verify:

1. Share one real video and one real channel; verify actual title/image and inspect content before approval.
2. Connect GitHub on the parent phone, approve, wait for Pages deployment, refresh the child app and play with picture and sound.
3. Confirm individual/channel/union views and deduplication; revoke both forms and refresh.
4. Share a second link during saving, and update from a second parent; check neither operation overwrites another parent.
5. Cancel while connecting, immediately open another video, rotate/resume, go offline/online, and confirm no late playback or next-video chain.
6. Check a missing/unavailable video, failed metadata and media-format fallback. A YouTube authorization block stops attempts and is not bypassed.

See ../AUDIT.md for the older web audit; it is not a hardware audit of this new parent app.
