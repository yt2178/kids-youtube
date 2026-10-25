-- Isolated human-reviewed starter packs; no legacy state or approval changes.
-- No candidate automatically becomes child-visible.
create table if not exists public.kids_age_pack_items (
 id uuid primary key default gen_random_uuid(),
 age_band text not null check (age_band in ('0-3','3-6','6-10','10-13')),
 approval_url text not null check (approval_url ~ '^https://www[.]youtube[.]com/watch[?]v=[A-Za-z0-9_-]{11}$'),
 title text not null check (length(btrim(title)) between 1 and 300),
 review_state text not null default 'candidate' check (review_state in ('candidate','approved','rejected')),
 reviewed_at timestamptz,
 review_note text,
 created_at timestamptz not null default now(),
 constraint reviewed_approval_required check (
  review_state <> 'approved' or
  (reviewed_at is not null and review_note is not null and length(btrim(review_note)) >= 20)
 ),
 unique(age_band,approval_url)
);
create index if not exists kids_age_pack_approved_idx
 on public.kids_age_pack_items(age_band,approval_url)
 where review_state='approved';
alter table public.kids_age_pack_items enable row level security;
revoke all on public.kids_age_pack_items from public,anon,authenticated;
-- No INSERT policy for parents or children; curation is privileged and reviewed.
