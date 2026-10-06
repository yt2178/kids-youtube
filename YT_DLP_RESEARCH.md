# yt-dlp feasibility — 2026-10-06

Latest stable release checked: **2026.08.19** (published Aug 19).
Latest nightly checked: **2026.09.27.232945**, commit 51bab8a0116f4d8004c315706d809782607d5847.
The test pins the stable release; it does not repeatedly switch builds after an upstream block.

yt-dlp is a maintained Python extractor/downloader, not a browser player.
Its Python API returns titles, channel IDs and media formats/URLs without requiring
a full download. Separate video/audio need a native player or FFmpeg for merging.
Current README specifies Python 3.10+ and recommends yt-dlp-ejs and a supported JS
runtime for full YouTube support.

It can support our application in either:
- A backend running Python plus a media delivery path (GitHub Pages cannot execute it).
- An Android native wrapper bundling its required runtimes, with a native player.

Android wrapper: https://github.com/yausername/youtubedl-android
Current README advertises 0.18.1, metadata/stream APIs and runtime updating; its
README still says Python 3.8, while yt-dlp requires 3.10+. This discrepancy is a
reason to verify actual packaged binaries, not assume the newest yt-dlp works.
The source library minSdk is 24. This wrapper is distinct from official yt-dlp.

No public comparative reliability dataset proves it fails less than NewPipe.
YouTube 403 and authorization errors are still documented, including issue17647
open at research time. Extraction success also does not prove actual media bytes
or playable audio/video.

## Actual experiment

qa/yt_dlp_probe.py checks that mVTlbvQ_010 is STILL directly approved in main/videos.txt,
then performs one normal extraction using stable yt-dlp. No custom client list,
cookies, proxies, impersonation configuration, token provider or challenge bypass
is added. The probe halts immediately on explicit HTTP401/403/429 or playability
login/age verification instead of following a library fallback after that block.

If extraction succeeds, it validates the exact ID, chooses a combined MP4 format,
reads at most 2MiB and attempts three-frame FFmpeg decoding. Signed URLs are never
saved to the public report. No full video is uploaded or published.

The complete attempt has a 45-second deadline and zero extractor/network retries.
CI preserves qa/yt-dlp-proof.json even on failure. The result must be read before
claiming that yt-dlp fixes our playback problem.

GitHub Actions runs on a cloud network. Failure/success there does not establish
the result on the Android tablet, and a decoded sample is not browser/device UI
playback. The separate NewPipe Android proof remains isolated and unchanged.

## Primary sources

- https://github.com/yt-dlp/yt-dlp
- https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19
- https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/tag/2026.09.27.232945
- https://github.com/yt-dlp/yt-dlp/wiki/EJS
- https://github.com/yt-dlp/yt-dlp/wiki/Extractors
- https://github.com/yt-dlp/yt-dlp/issues/17647
- https://github.com/yausername/youtubedl-android


## Observed result

Run: https://github.com/yt2178/kids-youtube/actions/runs/37434572106
Date: 2026-10-06, stable yt-dlp 2026.08.19, Python3.12 and Node24.
Eight probe guard tests and 122 existing website tests passed.
The actual live attempt **failed** in 1347ms with UPSTREAM_AUTH_REQUIRED:
HTTP200 response body contained a playability verification/login requirement.
The guard stopped immediately after the first YouTube response. No media format
URLs, bytes or decoded video were obtained. Channel enumeration was not attempted
after the known authorization block. Android/browser playback remains untested.

Conclusion: this test does not support replacing our player with yt-dlp in a free
cloud backend. yt-dlp remains technically usable in a native application via a
compatible wrapper, but that would need a separate device test and runtime audit;
it is not a proven fix. No change has been made to the deployed website.
