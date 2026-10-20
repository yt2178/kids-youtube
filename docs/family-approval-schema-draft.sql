-- DESIGN DRAFT ONLY: DO NOT APPLY TO PRODUCTION.
-- A new table only; does not alter the live singleton or catalog.
create table if not exists public.family_approvals (
  family_id uuid primary key references public.families(id) on delete restrict,
  list_text text not null default '' check (length(list_text) <= 1000000),
  version bigint not null default 1 check (version >= 1),
  updated_at timestamptz not null default now()
);
alter table public.family_approvals enable row level security;
revoke all on public.family_approvals from public, anon, authenticated;
grant select on public.family_approvals to authenticated;
-- Client writes stay denied pending an atomic authenticated server endpoint.
-- Children can only read the approval list for their bound family.
create policy family_approval_read on public.family_approvals
  for select to authenticated
  using (private.can_read_family(family_id));
-- A future trusted server will validate family identity and expectedVersion atomically.\n-- No client DELETE policy; a reset should replace the list, not delete the row.
-- Still required: atomic compare-and-swap version changes via trusted server.
