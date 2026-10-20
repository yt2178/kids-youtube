-- Staged additive schema. Never changes the legacy kids_youtube_state list.
-- This migration is NOT automatically applied by GitHub Pages.
create table if not exists public.family_approvals (
 family_id uuid primary key references public.families(id) on delete restrict,
 list_text text not null default '' check (char_length(list_text) <= 1000000),
 version bigint not null default 1 check (version >= 1),
 updated_at timestamptz not null default now()
);
alter table public.family_approvals enable row level security;
revoke all on public.family_approvals from public, anon, authenticated;
-- No policies or grants for browsers. The family Edge Function is the only
-- planned access path, via its service role with verified Auth user identity.
-- Do not copy legacy approvals into any tenant automatically.
