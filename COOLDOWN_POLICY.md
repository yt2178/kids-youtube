# Provider cooldown policy (2026-10-11)

This is a protection against repeated upstream blocking and rate limiting, **not** a response to DNS, TCP, bandwidth, Media3 buffering, or parent authorization failures.

- The Android native app uses ONE `UpstreamCooldown` instance for all NewPipe requests. Real upstream `UPSTREAM_BLOCKED` establishes 15 minutes, and real `RATE_LIMITED` establishes 2 minutes. A shorter limit never shortens an already active longer protection.
- `NativeApi.checkNetwork()` checks this before fetching a new video extractor, resolving an uncached channel, or requesting channel-tab pages. The `request()` path serves valid cached display information without contacting the upstream. A provider error from channel metadata can therefore temporarily prevent *new* video-source extraction as well; this existing common protection is intentionally preserved.
- `UpstreamCooldown.ActiveException` is a **local** `COOLDOWN_ACTIVE` refusal with remaining milliseconds. It does not contact NewPipe, does not report that YouTube blocked a new request, and does not renew expiry. Repeated attempts, including an error wrapped by another layer, do not extend it.
- The *same thrown upstream event* cannot be recorded twice, and the duplicate playback-preparation `MainActivity.recordFailure` call was removed. Recording originates from `NativeApi.request()`, `NativeApi.playback()`, or the one Media3 error owner where applicable.
- Opening a video still performs a fresh parent grant check before reaching NewPipe; after successful extraction it performs another fresh grant check. The cooldown cannot authorize, expand, or silently prolong a parent grant. Real revocation remains fail closed. `clear()` doesn't erase cooldown.
- The player overlay displays `COOLDOWN_ACTIVE` and remaining whole minutes/seconds at the time of the refusal. It invites a later retry. A real provider block has a different message. No per-second background ticker or scheduled provider probe was added.
- The exact upstream response that initially set the physical cooldown is **unknown** because the provided conversation excerpts do not cover the intervening playback attempts. CI tests use a controlled clock; they do not establish the behavior of the unstable physical network.

Scope: No changes to DNS, TLS, playback quality, timeouts, retry count, Media3 or Family Link.
