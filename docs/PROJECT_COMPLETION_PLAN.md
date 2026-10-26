# Kids YouTube — implementation gates and remaining work
Last reconciled: 2026-10-25. Keep this roadmap in Git and update evidence after each completed gate.

## Immutable safety rules
- Preserve legacy family approval data and current player. Do not copy, reset or delete legacy lists.
- No public enrollment, production billing, irreversible changes or broad migrations without explicit approval.
- A successful CI build is not proof of physical playback, cross-family isolation or content review.
- Never fallback from a paired family to legacy approvals on a failed family authorization.
- Never mark YouTube content safe merely based on its title, thumbnail, channel or metadata.

## Ordered delivery gates
1. Baseline: reconcile GitHub HEAD, Edge Function versions, DB schema/data; confirm rollback and legacy backups.
2. Parent onboarding: invitation-only verified email signup, login/logout, reset, creation, idempotent atomic enrollment; two verified test accounts.
3. Android pairing: anonymous identity, one-time code, encrypted refresh token, expiration, revocation, reinstallation and recovery in debug build.
4. Two-family isolation: A/B parents and A/B devices; deny cross-family reads and writes; revoked device must fail closed; E2E tests.
5. Family-native authorization/catalog: resolve all permissions by server-side identity; preserve catalog version and playback authorization semantics; no legacy fallback.
6. Playback: real-device video tests, HTTP 403 diagnostics and verified fixes, cancellation, seeking, quality and network interruption.
7. Curated age packs: 0–3, 3–6, 6–10, 10–13; watch and individually assess each candidate, record review evidence. Zero approved items currently.
8. Parent UX: age selection, audited reset/replace with explicit preview, backup/restore, child and device controls, accessibility/RTL.
9. Trial/subscription: entitlement modeling and payment-provider sandbox only; 10 ILS/mo proposed, no real charges.
10. Security/privacy: RLS/auth review, token/session expiry and replay, CSP, logging minimization, safeguarding child information and compliance review.
11. Private pilot: physical Android devices, real invitation flow, stability metrics and support, tested rollback.
12. Public readiness checklist; separate explicit go-live permission.

## Verified baseline
- Main commit bfd754c47f645ec2082ee50d8dc48c0e14605513: PWA & Android GitHub workflows succeeded.
- Independent kids-youtube-family Edge Function v5 deployed, with human-reviewed age-pack schema applied.
- Database read-only inspection (2026-10-25): 0 families, 0 devices, 0 age items, 1 legacy singleton row.
- Android family pairing Activity exists in debug-only builds; not physically validated.
- Age packs are intentionally empty, thus unavailable for selection.
- No full two-family identity E2E test completed. No proven resolution to 403 playback failures.

## Current critical blockers
- Need valid verified sandbox parent identities and authorized anonymous test device identities for end-to-end access tests.
- Confirm anonymous Auth enabled and invitation enrollment flow working under actual accounts before turning on enrollment flags.
- Family list responses alone are insufficient for legacy playback NativeApi catalog/auth contract; implement a separate authenticated family-native adapter and test fail-closed.
- Physical Android test access is needed to prove pairing, playback and token persistence.

Update this file as actual evidence changes. Do not label a gate complete without test logs, verified deployment and the stated acceptance criteria.

## Reconciliation — 2026-10-26 (post-PR #70)
- GitHub `main` verified at `54e2839aad5482a3bfa90c96633011df23e45323` (PR #70). PR #69 at `5d2818e8d0b97d6701c2d01003e640f8c0246991` is already included.
- PR #69 added a non-destructive Windows ADB capture entrypoint (`capture-family-playback.cmd`) and allowlisted `KidsFamilyPilot` diagnostic stages. Reports are local-only, under `family-pilot-diagnostics/`, and excluded from Git.
- PR #70 distinguishes `outcome-first-frame-confirmed`, `outcome-no-first-frame`, and player failure. A `media3-play-request` event **does not** establish successful playback. The capture script analyzes the latest smoke-start attempt only.
- These GitHub merges and source inspections do **not** establish that a Debug APK has been installed or tested on physical Android, or that pairing, cross-family isolation, media loading or HTTP 403 issues are resolved.
- Deployment/version status of live Supabase and the current database counts have **not** been independently rechecked in this reconciliation; the 2026-10-25 counts above are historical observations, not today's state.

### Immediate next gate — physical evidence, then fail-closed production integration
1. In a controlled development environment, build/install the current Debug app to an explicitly chosen authorized tablet; do not uninstall the current working app or erase its data. Record build SHA and Android version.
2. Use separately authorized family test account, paired test device and an explicitly approved video. Do not use or modify legacy-family approvals. Avoid claiming readiness when no authorized test identity exists.
3. Run the isolated Media3 smoke test, then double-click `capture-family-playback.cmd` from the repository root. Inspect the locally saved **sanitized** report. Only `FIRST_FRAME_CONFIRMED` is evidence of rendered video; `NO_FIRST_FRAME`, `FAILED_OR_BLOCKED` and `INCONCLUSIVE` require cause-specific investigation.
4. For HTTP 403, determine whether failure occurs during authentication, source extraction, media request, or playback. Correlate safely using fixed event names and HTTP class, not signed media URLs. Avoid speculative timeout or extraction-provider changes.
5. Before enabling the actual family player, prove two-family isolation and revocation with real separate identities and devices, including deny-on-error and no legacy fallback; design explicit expiry/revalidation and offline policy for an already playing video.
6. Keep active playback and public registration unchanged until physical evidence, relevant tests and a separate rollout decision. Log test outcomes here with date, device class, build SHA and sanitized verdict (never tokens, personal IDs or media URLs).

## Live Supabase read-only preflight — 2026-10-26
- Confirmed project ref `jxhelpxhrmwvzrrfrjuh` (the public family-pilot frontend uses this ref); the project status was `ACTIVE_HEALTHY`.
- `kids-youtube-family` Edge Function was ACTIVE at version 7. This is a deployment-state check, **not** an authenticated end-to-end exercise.
- Confirmed database counts at inspection: `families=0`, `devices=0`, `family_pilot_invites=0`, `kids_age_pack_items=0`.
- RLS enabled for inspected public tables `families`, `family_approvals`, `devices`, `family_pilot_invites`, `kids_age_pack_items`. This by itself does **not** prove correct policies or tenant isolation.
- Family approval, device pairing, invite, and age-pack migrations appeared in Supabase migration history.
- A real invitation and two separate verified test identities are still prerequisites to the actual cross-family access tests. Do not create production accounts or turn on enrollment flags implicitly.
- GitHub PR #72 passed both website and Android workflow checks and was merged into `main` as `394274dfc9b772b221a3b56dd8961ade039719d0`.
