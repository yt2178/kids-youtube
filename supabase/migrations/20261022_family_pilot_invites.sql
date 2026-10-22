create table if not exists public.family_pilot_invites (email text primary key, expires_at timestamptz not null, used_at timestamptz);
alter table public.family_pilot_invites enable row level security;
revoke all on public.family_pilot_invites from anon, authenticated;
