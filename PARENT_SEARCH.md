# Parent YouTube search — no API key

## Choice and evidence (2026-10-11)

We selected the maintained YouTube.js / InnerTube approach, pinned to `youtubei.js@18.1.0/web`, for metadata search only. It runs in a separate `kids-youtube-search` Supabase function and needs no Google Cloud account, API key, YouTube login, cookies, paid provider or public Invidious proxy.

Research covered project documentation, release discussions and issue reports. There is no representative survey proving a particular method has the most success reports. FreeTube's release discussion documents active use of YouTube.js and updates for changing search filters. YouTube.js documents Deno support and search without player extraction. Reports of breakage also exist: this remains an unofficial interface and may need maintenance after YouTube changes. No claim of permanent reliability or official API support is made.

Sources:
- https://github.com/FreeTubeApp/FreeTube/discussions/8917 (release and user discussion)
- https://github.com/FreeTubeApp/FreeTube/issues/8636 (search filter regression report)
- https://github.com/LuanRT/YouTube.js/releases (search filter fixes)
- https://ytjs.dev/guide/getting-started (runtime and configuration)
- https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/_search.py (independent search implementation)
- https://docs.invidious.io/instances/ (alternative public instances)

## Behavior

Explicit parent search returns video rows with thumbnail, title, channel name, official watch link and an add-to-kids button. Search itself never approves a video. Add uses the unchanged authenticated `mutate` action. Duplicate explicit video approvals are disabled; channel approvals continue to work as before.

The search function validates the parent bearer session through the existing `kids-youtube?action=status` authority before loading the search library or contacting YouTube. The core function, database and children's Android app are unchanged. No parent credentials are sent to YouTube. Only `https://www.youtube.com` is allowed as a library network destination; redirects and other destinations fail. Response bodies are bounded to 4 MB; the whole request has a 15-second abort deadline. Query, page count and displayed results are bounded. Library payload logging is disabled.

Pagination is stateless: requesting page 2 or 3 repeats the initial search and follows at most two continuations, avoiding reliance on an Edge isolate's memory. Maximum three pages, up to 50 validated video rows each. No automatic retries, automatic suggestions or background searching. New queries reset the list. YouTube restricted mode is requested but does not replace the parent's suitability decision.

## Verification

- Live pre-integration library probes: Hebrew search returned 23 videos; English search returned 20.
- The exact production `searchVideos` helper was exercised against real YouTube (only the `npm:` module specifier changed to the same installed version for Node). Hebrew page 1 and page 2 and English page 1 all returned real results, with durations about 6.4 s, 1.3 s and 0.8 s. Initial probe capped returned rows at 20; the final cap is 50 to avoid truncating ordinary upstream pages.
- Automated tests cover authentication failure, cross-origin rejection, request validation, upstream failure, Video/LockupView normalization, URL allowlisting, bounded pagination, frontend rendering, addition through existing mutation, duplicate clicks and stale responses after logout.
- These tests do not prove every search will work from every deployment region or that any particular video will play in the Android app.

## Deployment

Deploy `supabase/functions/kids-youtube-search/index.ts` as `kids-youtube-search` in the existing project, with gateway JWT verification disabled because the function explicitly validates the existing custom parent bearer session. The core `kids-youtube` function must not be redeployed for this feature. Publish the parent HTML/JS via GitHub Pages. No database migration, secret, API-key configuration or APK installation is needed.

If search is unavailable, the existing paste-link approval flow remains available. Never bypass the parent session check to make a live probe succeed. No real family approvals should be added or removed merely to test this feature.
