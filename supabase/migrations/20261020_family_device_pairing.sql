-- Staged addition only. No change to existing approvals, legacy auth or devices.
create table if not exists public.family_pair_codes (
 family_id uuid primary key references public.families(id) on delete cascade,
 code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz not null,
 consumed_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.family_pair_codes enable row level security;
revoke all on public.family_pair_codes from public, anon, authenticated;
-- Only the service-role Edge Function may use pairing state.
create or replace function public.claim_family_pairing(
 p_code_hash text, p_device_user uuid, p_device_name text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_family uuid;
begin
 if p_code_hash !~ '^[a-f0-9]{64}$' or p_device_user is null
  or p_device_name is null or length(btrim(p_device_name)) not between 1 and 80 then
  return null;
 end if;
 select family_id into v_family
   from public.family_pair_codes
   where code_hash=p_code_hash and consumed_at is null and expires_at>now()
   for update;
 if v_family is null then return null; end if;
 if exists(select 1 from public.devices where auth_user_id=p_device_user) then
  return null;
 end if;
 insert into public.devices(family_id, auth_user_id, name)
 values(v_family,p_device_user,btrim(p_device_name));
 update public.family_pair_codes set consumed_at=now() where family_id=v_family;
 return v_family;
end;
$$;
revoke all on function public.claim_family_pairing(text,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_family_pairing(text,uuid,text) to service_role;
