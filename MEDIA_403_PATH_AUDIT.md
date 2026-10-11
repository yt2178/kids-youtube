# Signed media HTTP 403 — source-to-player audit

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
