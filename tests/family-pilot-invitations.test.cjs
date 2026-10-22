const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20261022_family_pilot_invites.sql','utf8');
const fn=fs.readFileSync('supabase/functions/kids-youtube-family/index.ts','utf8');
test('invite store has no client grants; transaction performs complete provisioning',()=>{
 assert.match(sql,/enable row level security/);
 assert.match(sql,/revoke all on public\.family_pilot_invites from public,anon,authenticated/);
 assert.match(sql,/security definer set search_path = ''/);
 assert.match(sql,/update public\.family_pilot_invites[\s\S]*?used_at=now\(\)/);
 assert.match(sql,/insert into public\.families/);
 assert.match(sql,/insert into public\.family_approvals/);
 assert.match(sql,/revoke all on function public\.enroll_invited_family/);
 assert.match(sql,/grant execute on function public\.enroll_invited_family\(text,uuid,text\) to service_role/);
});
test('family enroll route fails closed and invokes only atomic RPC',()=>{
 assert.match(fn,/FAMILY_PILOT_ENROLL_ENABLED/);
 assert.match(fn,/FAMILY_PILOT_INVITES_READY/);
 assert.match(fn,/getVerifiedEmail\(req\)/);
 assert.match(fn,/rpc\/enroll_invited_family/);
 const section=fn.slice(fn.indexOf('if(action==="enroll")'),fn.indexOf('if(action==="pair-device")'));
 assert.doesNotMatch(section,/\/rest\/v1\/families"/);
 assert.doesNotMatch(section,/\/rest\/v1\/family_approvals"/);
 assert.doesNotMatch(section,/\/rest\/v1\/family_pilot_invites\?/);
});
