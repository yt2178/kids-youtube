# Approved YouTube playlists

Parents can paste a public or unlisted YouTube playlist URL into the existing
parent website, preview its title and item count, and approve it once. They then
use YouTube's Save button to maintain that playlist. No additional parent app,
Google Sheets, API key or YouTube account credentials are required.

## Authority and synchronization

- The database stores the **playlist source URL**, never permanent per-video
  approvals imported from it. Direct video and channel grants remain separate.
- On every `list&format=native` or `list&format=effective` request, the server
  reads all playlist pages afresh. It converts current accessible members into
  canonical direct-video grants for existing clients. Native polling and BOTH
  pre/post-extraction checks therefore apply to playlist members unchanged.
- Removing a member removes only this source's grant. Another approved playlist,
  a direct approval or an approved channel can independently authorize the video.
- No persistent membership cache, stale fallback or extra client-side trust is
  introduced. Failed/incomplete/oversized reads grant nothing from that playlist;
  independent sources remain available. `unavailablePlaylists` reports failures.
- The server rechecks parent state after membership/catalog reads. Concurrent
  parent edits return 409 instead of an old grant. Client fingerprints include
  the effective list, so playlist edits do not need a database version increment.
- Updates are observed on the next existing authorization check, including
  playback preparation and foreground polling (normally 60 seconds). This is
  **not instant push synchronization**. YouTube can delay publishing edits and
  does not provide an atomic multi-page membership snapshot through this API.
- Existing playback revocation behavior is preserved; this feature does not add
  a new timer that interrupts an already playing video.

## Bounds and limitations

Three approved playlists maximum; 500 entries per playlist and ten pages maximum.
Duplicates count toward the read limit but grant only once. Playlist reads run
in parallel under a nine-second per-playlist abort signal. Metadata uses the same
response as authorization on Android and the updated web viewer, with at most
500 prepared display rows; permission is never inferred from that display limit.
No fresh lookup is made for families with no playlist grants.

Only normal `PL…` playlist IDs are accepted. Private playlists, Watch Later,
Liked Videos, automatic mixes and account-dependent lists are unsupported.
A watch URL with both `v` and a valid `list` approves the **playlist**, not only the current video.
Use a watch URL without `list` to approve a single video. The preview explicitly explains that
future additions are approved. Use a playlist whose editors the parent trusts.

The implementation uses pinned YouTube.js 18.1.0, already used for parent search.
It uses `Playlist.items`, excluding recommendations, follows continuations, and
validates LockupView membership against the requested playlist. Only HTTPS
requests to `www.youtube.com` are allowed, redirects are rejected, response
bodies are bounded, and no parent credentials are forwarded. Upstream availability
is a dependency; a YouTube change or block may temporarily make members unavailable.

## Verification

Run `node --test tests/*.test.cjs`. Added runtime tests exercise addition, removal,
independent grants, overlaps, complete paging, page failures, empty lists, size
limits, unauthorized changes, recommendation rejection and concurrent deletion.
Parent UI tests exercise preview, approval, checking current membership and removal.

On 2026-10-20 the actual `readPlaylist` implementation successfully read public
playlist `PLrfcruGtplwHxMQ6Wi2x0uVIrHF9uFcSz`: 20 valid video IDs, title
“Astronomy Online!”, approximately 4.5 seconds in the development environment.
This read did not add it to the family's approvals. Type checking passed with
Deno and the pinned library. These are not a physical Android playback test.

No Android Java, Media3, NewPipe, TLS policy or playback retry code changed.
Existing Android clients use the expanded native response without an APK update.

References checked 2026-10-20:
- https://ytjs.dev/api/youtubei.js/namespaces/YT/classes/Playlist
- https://github.com/LuanRT/YouTube.js/blob/v18.1.0/src/parser/youtube/Playlist.ts
- https://support.google.com/youtube/answer/3127309?hl=en
