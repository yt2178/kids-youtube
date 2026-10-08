-- Run ONLY on a separate, empty Supabase staging project.
-- Never run this against jxhelpxhrmwvzrrfrjuh (the family's production project).
create table if not exists public.kids_youtube_state (
  singleton boolean primary key default true check(singleton),
  list_text text not null default '',
  password_hash text,
  session_secret text not null,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.kids_youtube_state enable row level security;
revoke all on public.kids_youtube_state from public, anon, authenticated;
grant select, insert, update, delete on public.kids_youtube_state to service_role;
insert into public.kids_youtube_state(singleton,list_text,password_hash,session_secret,version)
values (true,'',null,encode(gen_random_bytes(32),'base64'),0)
on conflict(singleton) do nothing;
-- Apply supabase/migrations/20261008_kids_youtube_catalog.sql afterwards.
