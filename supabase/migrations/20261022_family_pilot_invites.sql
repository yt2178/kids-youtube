-- Additive pilot-only schema; does not touch legacy approvals.
create table if not exists public.family_pilot_invites (
 email text primary key,
 expires_at timestamptz not null,
 used_at timestamptz,
 created_at timestamptz not null default now(),
 constraint pilot_invite_email check(email = lower(btrim(email)) and length(email) between 3 and 254)
);
alter table public.family_pilot_invites enable row level security;
revoke all on public.family_pilot_invites from public,anon,authenticated;

-- One transaction performs invite claim, family creation and approval-list creation.
-- The Edge Function has already independently authenticated the Auth user.
create or replace function public.enroll_invited_family(p_email text, p_user_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
 if p_email is null or p_user_id is null or p_name is null or
    length(btrim(p_name)) not between 1 and 80 then
   return null;
 end if;
 select id into v_id from public.families where owner_id=p_user_id;
 if v_id is not null then return v_id; end if;
 update public.family_pilot_invites
    set used_at=now()
    where email=lower(btrim(p_email)) and used_at is null and expires_at>now();
 if not found then return null; end if;
 insert into public.families(owner_id,name) values (p_user_id,btrim(p_name))
   returning id into v_id;
 insert into public.family_approvals(family_id,list_text,version)
   values(v_id,'',1);
 return v_id;
end;
$$;
revoke all on function public.enroll_invited_family(text,uuid,text) from public,anon,authenticated;
grant execute on function public.enroll_invited_family(text,uuid,text) to service_role;
