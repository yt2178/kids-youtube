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
