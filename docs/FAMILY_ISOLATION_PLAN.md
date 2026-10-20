# Family isolation — staged foundation (not deployed)

Audit date: 2026-10-20. Production Kids YouTube Supabase project `jxhelpxhrmwvzrrfrjuh`.

## Verified inventory (read-only)
- `public.families`, `public.children`, `public.devices`: RLS enabled; **zero** rows each.
- `public.kids_youtube_state`: **one** singleton row with current family approvals, password/session state.
- `public.kids_youtube_catalog`: seven display-metadata rows associated with the singleton.
- Private authorization helpers `private.is_parent(fid)`, `private.can_read_family(fid)` are SECURITY DEFINER. Review their full bodies, search_path, EXECUTE privileges and grants before activating new tenants.
- Existing parent page relies on a custom password/session and `kids-youtube?action=list/replace/mutate`. This is **not** a Supabase Auth user identity.
- Existing child Android authorization reads the singleton via the existing edge function.

## Phase 1: isolate storage without activating families
A draft SQL design in `docs/family-approval-schema-draft.sql` adds **one** family-scoped approval table. No existing rows are copied, removed, or reassigned. RLS denies anonymous access and permits only family parent writes; child read is conditional on the existing private authorization helper. It does **not** authorize by user-controlled family IDs or client-supplied claims.

The SQL is intentionally a draft, not an automatically applied migration. Before execution:
1. Review and validate private helper implementations and RLS grants, including function SECURITY DEFINER search_path.
2. Confirm authenticated role and owner behavior in a separate isolated Supabase test project.
3. Add a server-side family resolution from a **verified** Auth user/device, never a client `familyId` header.
4. Run cross-family tests: parent A cannot read/write B; device A cannot read B; revoked device cannot read A; unauthenticated client reads nothing; changed approval version rejects replacement.
5. Add a dedicated family endpoint, and only after staged verification decide how to migrate **one** legacy household. Keep the current singleton service unchanged until cutover is independently proven.
6. Keep signup/payment disabled until those tests and safe rollback succeed.

## Rollback principle
Nothing in this branch should be deployed to the production database without an explicit cutover strategy and snapshot/restore validation. Legacy data remains authoritative until then.
