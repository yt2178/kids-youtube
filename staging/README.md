# Kids YouTube — isolated staging

This is a **test-only** procedure. The family's existing production project
`jxhelpxhrmwvzrrfrjuh`, family list, login and Edge Function must not change.

1. Select a Supabase **Free** organization with available quota and confirm
   that creating the new project costs **0**. No paid tier or credit card.
2. Create a *separate* Supabase project. Record its ref.
3. Run `staging/initialize.sql`, then
   `supabase/migrations/20261008_kids_youtube_catalog.sql` **only in staging**.
   Staging starts with an empty approval list and a new independent signing
   secret; no family data is copied.
4. Deploy `supabase/functions/kids-youtube/index.ts` into **that project only**,
   name `kids-youtube`, `verify_jwt=false` because parental writes are
   authenticated by the function's HMAC session checks.
5. Set the GitHub Actions repository variable `KIDS_YOUTUBE_STAGING_URL` to
   `https://<staging-ref>.supabase.co/functions/v1/kids-youtube`. The value must
   not be production. Do not set a dummy URL.
6. Re-run the **PR branch** Android workflow. The optional staging job builds:
   `Kids-YouTube-Staging.apk` (application ID `il.kidsyoutube.staging`, launcher
   name `סרטונים לילדים — בדיקה`, scheme `kidsyoutube-staging`),
   `Kids-YouTube-Staging-Web.zip` and `SHA256SUMS.txt`. It embeds the same
   pull-request head SHA and API host. The normal APK stays unchanged.
7. Serve the generated static staging ZIP via an isolated staging Pages path.
   Browser storage keys and SW caches have `staging` namespaces. Never modify
   the GitHub Pages configuration of the active child PWA.
8. Open staging parents.html, choose an independent *test-only* password using
   setup, approve a test channel, and exercise metadata, pagination, revoke,
   re-add and offline fail-closed. Never use the family's links or password.
9. On device, install the staging APK **alongside** the current app. Collect:
   `adb logcat -c`, launch staging, then
   `adb logcat -d -s KidsStartup:D Choreographer:I HWUI:I > kids-stage-startup.log`.
   Record first cold, first initialized and warm launches separately, and
   correlate the printed `build=<SHA>` with the APK artifact.

Shared catalog records are **display data only**, and are filtered by a
separate fresh approval-list read on every app opening. No clock-based
background job or YouTube Data API key is required. Parent addition prepares
one bounded chunk; the authenticated `action=prepare` endpoint can append
one continuation page per explicit request. If a provider fails, the existing
valid display rows remain; failed preparation cannot grant access. Older
`@handles` are not silently repinned. New handles are pinned to a verified UC
channel ID when resolver data is available; otherwise old alias semantics
continue pending an explicit parent decision.

**Do not deploy these changes to production** until staging and physical
acceptance are complete.
