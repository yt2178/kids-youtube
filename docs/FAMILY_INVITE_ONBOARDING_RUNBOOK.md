# Family pilot: invitation-only onboarding and acceptance gate

**Status: not activated.** This document is a safety-gated operator procedure, not permission to change live Auth settings or existing family approvals.

## Verified implementation
- The `kids-youtube-family` enrollment API requires `FAMILY_PILOT_ENROLL_ENABLED=true` AND `FAMILY_PILOT_INVITES_READY=true`. Both are intentionally off for the current closed pilot.
- Enrollment requires a non-anonymous, **email-confirmed** Auth user; the email is obtained by the server from Supabase Auth, never trusted from a supplied request body.
- `public.enroll_invited_family` atomically consumes a matching unexpired, unused `family_pilot_invites` entry, creates a family, and creates an empty versioned approvals list. Only the service role may execute the RPC.
- The existing `family-pilot.html` supports password sign-in for verified **existing** Auth users and creates a family if invited. It does not yet implement signup, password setup for an Auth email invite, or recovery.
- Do **not** add a generic public `/auth/v1/signup` button: ordinary Auth signup can create accounts before a pilot invitation is verified. Use trusted Supabase Admin invitations.

## Preconditions
1. Explicitly select operator-controlled, consented test identities. Verify Auth confirmation settings, redirect allowlist and the mail delivery mechanism; do not assume an invitation link has a working password-setup landing page.
2. Confirm that the Auth setup/password recovery flow is implemented for the invitation redirect. Until then, keep the project in existing-user-only login mode.
3. Keep enrollment feature flags off before controlled staging rehearsals and explicit rollout approval; keep public signup disabled.
4. Preserve the legacy family singleton, existing approvals and Android live playback unmodified. Back up any affected production data before trial migrations or family writes.

## Controlled enrollment — only after the above
1. Create a short-lived invitation for an authorized test email in the protected pilot invite table through an operator-only process. Inserting this row does **not** send email.
2. Separately send a Supabase Auth invite from the trusted Dashboard (Authentication → Users → Invite user) or server-side Admin API. Never expose admin/service keys to browser or mobile code.
3. Complete confirmation/password setup through the verified redirect path. Sign in through the pilot portal using a verified account.
4. Confirm `NO_FAMILY` leads to the empty pilot setup only, then call `enroll` and verify one family and one versioned empty approval list. A repeat call must not create duplicates.
5. Use a second independently verified account to test cross-family reads/writes, child-device restrictions, revoke behavior and fail-closed responses. Capture only sanitized response classes.

## Acceptance scenarios (not yet executed)
| Test | Expected |
|---|---|
| Unauthenticated enrollment | 401 |
| Anonymous-device enrollment | denied |
| Unconfirmed email | denied |
| Confirmed account, no invite | denied |
| Expired or consumed invite | denied |
| Confirmed identity with valid invite | one family, empty approvals list |
| Repeat enrollment by same parent | same family, no duplicate |
| Parent A attempts family B operations | denied |
| Revoked device fetches grants/catalog | denied |
| Failure of family API | never falls back to legacy approval list |

## Read-only inspection
```sql
select 'families' name, count(*) from public.families
union all select 'devices', count(*) from public.devices
union all select 'invites', count(*) from public.family_pilot_invites;
```

**Stop conditions:** Do not claim pilot-ready until real email/verification, password setup, tenant isolation and Android pairing/naming/playback are proven with independent test identities and physical-device evidence. Do not enable public registration, production billing, or modify legacy data.
