# Signed media HTTP 403 — source-to-player audit

## Follow-up: physical playback 3 on F21 Pro, 2026-10-11

Base: `402ab71a1fcf5befc31501135c1d4f9d967e0b20` (documentation after PR #30).
WebView 83 compatibility is closed and is not changed by this investigation.

Read directly: `Pasted text(20261011-095553).txt` (457 lines) and
`Pasted text(20261011-100101).txt` (132 lines). The latter is an excerpt starting
at source 1's HTTP response, not a complete playback-3 startup log.

- Playback 1 on build `46f3ba4196af6f7002b3e1bea5f67c079e4b42c1`: both fresh
  grants succeeded, extraction produced six sources, 240p/314258 bitrate,
  separate audio/video returned 200 in 219/261 ms, first frame 1100 ms,
  READY 2188 ms and isPlaying=true. Both URLs reported 21599 seconds to expiry.
- Playback 3 source 1: video 403 at 194 ms and audio 403 at 201 ms. Both
  MediaHttpFailure events preceded the UI error at 13:00:26.858. Media3 surfaced
  the **video** exception. Source 2 (240p/314258) then returned audio/video 403
  in 126/146 ms; both reported about 21599 seconds until expiry. Playback stopped.
- This is an explicit media HTTP rejection, not an observed DNS failure or
  buffering timeout. The excerpt does not contain playback 3's grant/extraction
  events, source 1 resolution, video IDs, client query value or signed URLs.
  Do not invent them or claim cryptographic validation from expiry alone.

### Proven local fallback defect

`NativeApi.playback` selects the first compatible progressive M4A audio and pairs
it with every compatible video-only quality. `PlaybackChoices` ranks bitrate and
height, not independent audio identities. Previously `MainActivity.advance` skipped
shared audio **only when the one exception selected by Media3 was audio**. The
physical order above bypassed that condition even though both tracks had failed.

The fix records observed 401/403/429 responses from both loader threads in one
playback-local, synchronized `MediaSourceFailures`, before propagating exceptions.
Fallback skips any candidate reusing a known-rejected video or audio URL, regardless
of which error Media3 reports. Redirect rejections retain the original source key.
Comparison uses OkHttp URL canonicalization; no URL or key is logged/persisted.
Fresh playback gets a fresh tracker so late old responses cannot poison it.
The one-alternative and six-candidate ceilings remain. A recorded 429 cannot be
hidden by a simultaneous video 403. No request is added to discover failures.
An in-flight track that has not yet returned a rejection is not presumed rejected.

This avoids futile fallback requests; it does **not** make a rejected source playable.

### Header evidence correction

The previous `userAgent=false` was measured from `call.request()` before OkHttp's
BridgeInterceptor adds its default User-Agent. It was not evidence about the wire.
Diagnostics now use `requestHeadersEnd` for each actual request (including redirects).
Only header-presence flags, relative expiry, query-key count and boolean indicators
for signature/n/poToken presence and VISIONOS are reported, never values. Those
flags identify possible compatibility differences but cannot validate a signature
or prove an integrity requirement was met.

### Upstream research and limits

- [NewPipe issue 13824](https://github.com/TeamNewPipe/NewPipe/issues/13824) is open;
  its current title identifies VISIONOS poToken enforcement. Several comments
  describe failures around 55–60 seconds and temporary success after restarting.
  Our excerpt instead fails on initial media open. The shared 403 symptom is relevant
  but does not establish the same cause or justify client switching/token fabrication.
- [Extractor v0.26.5](https://github.com/TeamNewPipe/NewPipeExtractor/releases/tag/v0.26.5)
  remains the latest listed release when checked. Its `YoutubeStreamExtractor`
  combines Android/VISIONOS/iOS streaming data, deobfuscates signature and `n`,
  and supports optional PoTokenProvider. Its own documentation warns that without
  a provider some formats may not be available. Our downloader does not install one.
- Extraction creates new stream URLs and hands `getContent()` through unchanged.
  This does not prove a provider accepts their signature, IP/client binding, or
  integrity data. Metadata headers are propagated; the Stream API supplies no
  per-stream media-header map to propagate. No speculative headers were added.
- The affected video identities and raw signed requests are absent. We cannot
  reproduce these particular YouTube responses or compare their private request
  context from this environment. CI is not a physical success claim.

### Validation scope

`MediaSourceFailuresTest` exercises the production media interceptor with a
MockWebServer terminal transport: dual-track 403 with video reported first,
working independent alternative, video-only failure with working shared audio,
all candidates sharing rejected audio, and an independent alternative also failing
without a third attempt. It also checks playback isolation, exact URL identity,
429 handling, and actual OkHttp-added headers against sanitized trace output.
The terminal test transport uses HTTP locally; it is not real YouTube/TLS/Media3
end-to-end playback. Existing redirect/TLS/grant regressions remain required.

The earlier audit below is historical context, not the availability status of the
newly read files above.

Scope: the physical report of HTTP 403 on requests 24–31 for **two** pre-extracted sources (240p then 144p). The detailed original physical log is **not available among the uploaded conversation files** for this turn; the counts and reported resolution sequence are user-supplied. No claim is made about each original HTTP request's track or library retry origin.

## What the code proves

1. `NativeApi.playback()` always performs a new `extractVideo(id)`, calling `ServiceList.YouTube.getStreamExtractor(...).fetchPage()`. This is not the catalog `Cache` and does not reuse an old saved media address. The mandatory **fresh parental grant checks before and after** extraction remain.
2. Progressive-MP4 `VideoStream.getContent()` and `AudioStream.getContent()` values are stored directly in `NativeApi.Source(video,audio)`. No part of `getContent()` is intentionally dropped. `MainActivity` passes each source directly to `MediaItem.fromUri`. `safeMedia` verifies HTTPS Googlevideo domain/port but does **not** strip or decode query parameters. OkHttp may canonicalize a URL when parsed, which is not proof of server acceptance.
3. A combined A/V MP4 has **one** progressive `MediaSource`. Video-only sources use `MergingMediaSource(video,audio)` and **two** HTTP data sources; the same selected audio URL can be reused across multiple video-only qualities. This explains the possible roles without assigning them to requests 24–31.
4. `ExtractorDownloader.execute()` propagates NewPipe's request headers for **extractor metadata**. Media3's `OkHttpDataSource` creates separate HTTP requests for the signed **media** URL and supplies standard request headers (including Range for nonzero positions and Accept-Encoding). The app does not currently import NewPipe's metadata headers into signed media requests. Inspection of the exact upstream `v0.26.5` `Stream.java` API found `getContent()`, `isUrl()`, and `getDeliveryMethod()`, **but no per-stream request-headers property**. `YoutubeStreamExtractor.java` builds stream content from `ItagInfo.getContent()`. Thus the app is not silently dropping a declared `VideoStream` headers field. This is **not** proof that YouTube will accept Media3's separate HTTP request headers; no speculative User-Agent or Referer header was added.
5. The app uses `NewPipeExtractor v0.26.5`, the latest listed stable release at the time of the audit. The extractor's YouTube implementation supports an optional `PoTokenProvider`. Known 403 issues in the ecosystem, including September 2026 reports, are **possible external context**, not proof of which URL/token/headers failed for this user. Do not switch clients, add token fabrication, or bypass YouTube access checks to guess a fix.

## Confirmed local bug and fix

Before this patch, media 401/403/429 entered the OkHttp interceptor as `MediaHttpFailure` (an `IOException`) and was often wrapped by `OkHttpDataSource`. Media3's `DefaultLoadErrorHandlingPolicy(0)` returns a retry delay for general IO failures: **setting the minimum retry count to zero does not itself force `getRetryDelayMsFor` to return `TIME_UNSET`**.

`MediaSourceLoadPolicy` now returns `C.TIME_UNSET` specifically when the cause chain contains a typed media HTTP failure. Audio and video both use it. Existing policy behavior for DNS, transport interruptions, and other errors remains unchanged. This removes a potential automatic replay of the **same rejected signed source**, without adding any requests or affecting the separate one-alternative-source choice.

## Debug-only attribution

`KidsMedia` events include playback generation, source ordinal, **per-source HTTP call number**, audio/video track, method GET/other, Range presence, presence of User-Agent/Referer/Origin (not their values), query **key count**, seconds to URL `expire` if present, HTTP status and elapsed time. No host, path, query values, signed URLs, cookies or tokens are printed. The event listener overrides the legacy extractor-only network attribution for Media3 calls. These fields allow *future* correlation of per-source calls, but do not reconstruct past requests 24–31.

## What remains unknown

- Whether the two physically rejected URLs were valid at the first request, whether their `expire` values had passed, whether the network/provider was rejecting their signature, or whether a header/other integrity requirement was unmet.
- Whether requests 24–31 were 4 audio + 4 video, HTTP range loads, library retries, or another mixture; without matching call/track/Range/load information the count does not prove any single explanation.
- The exact physical NewPipe-produced signed URLs cannot be fetched by this CI environment. No comparison is claimed between a real extracted URL and an actual device Media3 request, and no extra live request was sent. Synthetic URL-integrity assertions and Media3 policy tests are **code regressions only**, not proof that YouTube will accept the source on the affected network.

## Security invariants

Fresh parental verification both before and after NewPipe extraction is unchanged. TLS checks, `safeMedia` allowlist, safe redirect validation, Family Link and no credentials in logs remain unchanged. No extra retries, resolution change, CDN probes, bypasses or global network modifications were added.
