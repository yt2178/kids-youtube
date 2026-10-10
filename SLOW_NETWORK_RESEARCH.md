# Weak and unstable network work — 2026-10-11

## Evidence vs assumptions
Physical Android build `97eb7d2255e` succeeded on a different shared Wi-Fi without reinstallation, including playing a movie and blocking it after parent revocation. The first network showed repeated `UnknownHostException`, an intermittent `SocketException`, and one authorization timeout. DNS failure is not a bandwidth measurement. We did **not** reproduce the physical cellular/router DNS issue in CI.

## Network map and budgets

| Operation | Transport | Amount / concurrency / cache | Limit and retry |
| --- | --- | --- | --- |
| Initial grants plus prepared display data | Android bridge → authorization worker → OkHttp → Supabase Edge `list?format=native` | Current list plus pins plus *optional* bounded (<=400 KB) catalog. One on startup. No stale authority fallback | JS 36s; native task 34s; OkHttp authorization 32s, connect 8s, read 14s; UI bounded retry 6/18/45s |
| Periodic/foreground/partial-retry grants | Same independent authorization worker; Edge `detail=grants` | Current list plus verified pinned handles, **no prepared catalog**. Every 60s while visible; changes still fail closed | Same fresh-check budgets; periodic failure hides approvals, optional partial metadata failure does not |
| Fresh approval checks before/after extraction | NativeApi → same compact grant endpoint | Exactly two uncached grant fetches per requested playback. Neither can be replaced by catalog metadata | Max 32s per call; 85s shared extraction scope |
| Server prepared catalog | Edge → PostgREST catalog table, then version/state recheck | Read once on initial display request; rows filtered by exact parent list. Up to 250 catalog rows/400 KB optional payload | 6s catalog state read each; no mandatory provider scrape. Prepared bundle is display only |
| Legacy channel resolution and metadata | App JS → native bridge `api` → 3-worker NewPipe (one optional concurrent native metadata in JS) | TTL: video metadata 6h, channel metadata 5m; persistent display snapshot only after fresh grant | JS bridge 15s/native task 14s, NewPipe OkHttp connect 5/read 8/call 12s, no hidden retries |
| Channel page | Same NewPipe optional path | One native optional page at a time, prepared page can display immediately; background retry bounded, not full preload | Native bridge 14s / NewPipe per-call 12s, one optional worker |
| Card thumbnails | WebView image requests to allowlisted Google image hosts | Lazy below viewport; 320×180 `mqdefault.jpg` for video cards, no thumbnail in grant-only reply | Image failure uses fallback; no grant modification |
| Source discovery | Separate 1-thread playback executor → NewPipe with new fresh grants on both sides | MP4 progressive with audio or merged progressive video+audio; up to 10 distinct signed sources stored for this playback | Total bounded extraction scope 85s; failures typed; no autoplay prefetch |
| Media transfer | Media3 + OkHttpDataSource + HTTPS/googlevideo redirect allowlist | Range/progressive chunks; independent connection, bandwidth meter transfer listener, 12 MiB max target memory | No **whole-call** 12s timeout while streaming; connect 8s/read 20s; progress-aware buffer watches every 20s; 120s overall source retry window, <=6 sources |
| Parent auth/inspect/list/write | parents.js fetch → Edge | JSON bounded server-side, parent list version compare, idempotent add/remove; no duplicate automatic POST retry | Abort after 20s. Server state/metadata/proxy budgets remain unchanged |

The parent-site embedded YouTube iframe is managed by YouTube, not the child's Media3 source selector; its bitrate adaptation remains outside this app's control. Images are naturally lower priority than grants because grant requests run in a dedicated native worker pool. Native playback cancels optional native requests and uses its own worker.

## Quality policy
The source list consists of distinct progressive MP4 URLs (including optional merged M4A). The app does **not** advertise adaptive HLS/DASH. `PlaybackChoices.order` selects an available source using a cautious 65% bandwidth budget, or a lower data-saver cap. It starts conservatively before transfer measurements are available; later playback attempts can use the measured throughput. Manual menu resolutions are populated only from actual extracted sources. On stalls the app waits if buffered position grows, and then tries lower quality from this extraction before alternatives; it keeps playback position if possible. Manual quality change re-enters two fresh authorization checks before extracting to avoid reusing a revoked grant. For a link slower than the lowest real source bitrate, buffering can be unavoidable and ends in a clear bounded error.

## Automated checks and limits
- Actual production OkHttp + MockWebServer: one request at ~1 Mbps, one at ~256 Kbps with 350ms response delay/chunks, intermittent DNS failure and recovery (DNS injected, TLS policy unchanged), disconnect then revoked grant, compact/full request shape.
- JUnit deterministic available-bitrate preference for 256 Kbps, 1 Mbps, data saving and manual existing resolutions.
- Existing fail-closed concurrency, revocation, TLS certificate, direct server Edge function policy, browser UI, and build checks remain in CI.
- Measured in the network tests: request count and bounded completion; no physical throughput or bytes-on-device are claimed.
- Not measured: real frame-first latency, actual playback rebuffer percentage, visual UI on 256 Kbps, live DNS behavior of the slow Wi-Fi, server-to-user transfer bytes, and 256 Kbps YouTube media viability. These require an emulator with a real media stream or a single future physical test. CI green is **not** physical validation.
- Automatic APK Releases, tags, staging and family resets stay disabled. Deploy only the production Edge function and static parent Pages after CI.
