# Provider vs signed-media HTTP failures (2026-10-11)

This document describes the **local application policy**, not a timeout mandated by YouTube.

## Source HTTP errors vs NewPipe upstream errors

- A progressive Googlevideo MP4 URL is a **media source**, not the provider's general extractor API. MediaClient preserves HTTP **401**, **403**, and **429** as `MediaHttpFailure(status,track)` (`track=video` or `track=audio`). HTTP status and track are logged; **no signed URL or token is logged**.
- A 401/403 for one signed source **never sets a provider-wide cooldown**. It can be caused by a rejected or expired URL or other reasons; the actual cause is not proven from the response code alone. Media3 may have separate video and audio requests for video-only streams; progressive streams already containing audio have only one source. Four failed media requests do not by themselves identify their exact roles.
- After 401/403, the player can try at most **one** distinct alternative from the already extracted and allowed sources, within its existing six-source/120-second ceilings. If the failed track is audio, alternatives using the **same** rejected audio URL are skipped. No automatic global extraction, CAPTCHA bypass, DNS override, or infinite retry is introduced.
- Media HTTP 429 is reported as a media-source rate limit **without switching through several sources or setting a general NewPipe cooldown**, as one CDN/media URL does not establish general extractor throttling. It is separate from a genuine NewPipe 429.
- Once alternatives are exhausted, the UI names the media stage and HTTP 401/403 (or 429). The user's retry button invokes the existing fresh pre-extraction parent authorization, obtains fresh sources, and performs a fresh post-extraction authorization. This is a **user action**, not an automatic loop.
- Both mandatory fresh parent checks, allowlisted HTTPS Googlevideo redirects, and standard TLS validation are unchanged.

## Actual extractor/provider protection

- A **real NewPipe upstream** block/CAPTCHA/login-required response is still `UPSTREAM_BLOCKED`; it is **not** equivalent to a signed media URL's HTTP 403.
- The prior **15-minute shared cooldown is removed**. Real extractor/provider blocks now use a **60-second local protective pause** and NewPipe HTTP 429 still uses **120 seconds**. Neither duration is a documented YouTube instruction.
- A single provider cooldown still guards the three classes of **new NewPipe** work: video source extraction, channel resolution and channel-tab metadata. A genuine failure in one class can temporarily hold the others. Valid cached display metadata can still be used only after fresh parent authorization.
- `COOLDOWN_ACTIVE` indicates a local refusal; repeatedly pressing Play during that pause does not move its expiry. The same exception cannot renew the pause twice. Parental grants are never cached as substitutes.
- This is a local, in-memory cooldown; it expires naturally and is not synchronized with YouTube response headers.

## Test boundary

JUnit uses actual OkHttp + MockWebServer to read a 403 after two real fresh mock grant requests, with modeled extracted media sources; it verifies a bounded alternative and zero global cooldown. These are **not** proofs of genuine NewPipe extraction or physical Media3 playback in the user's unstable network. Further tests cover 401/403/429 categories, video/audio labeling, true provider block, 429 provider rate limit, local expiry and deduplication. The physical run first displayed 720p then reported four HTTP 403 transfers; without the actual uploaded log and per-track request IDs, we cannot prove whether those four were audio/video/ranges/retries.
