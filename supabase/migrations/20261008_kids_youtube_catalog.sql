-- Additive display-only catalog; never a source of approval.
-- Read/write through the Edge Function's service role only.
create table if not exists public.kids_youtube_catalog (
  approval_url text primary key,
  kind text not null check(kind in ('video','channel')),
  item_id text not null,
  title text not null default '',
  thumbnail text not null default '',
  published bigint not null default 0,
  channel_id text not null default '',
  page jsonb not null default '[]'::jsonb,
  continuation text,
  pages_loaded integer not null default 0 check(pages_loaded between 0 and 8),
  complete boolean not null default false,
  updated_at timestamptz not null default now(),
  checked_at timestamptz not null default now(),
  constraint catalog_url_length check (length(approval_url)<=4096),
  constraint catalog_title_length check (length(title)<=500),
  constraint catalog_page_length check (octet_length(page::text)<=200000),
  constraint catalog_cursor_length check (continuation is null or length(continuation)<=20000)
);
alter table public.kids_youtube_catalog enable row level security;
revoke all on public.kids_youtube_catalog from public, anon, authenticated;
create index if not exists kids_youtube_catalog_checked_idx
  on public.kids_youtube_catalog (checked_at);
comment on table public.kids_youtube_catalog is
  'Non-authoritative YouTube metadata. Never read without fresh kids_youtube_state approval filtering.';
