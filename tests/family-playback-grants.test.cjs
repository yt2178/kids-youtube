const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const edge=fs.readFileSync('supabase/functions/kids-youtube-family/index.ts','utf8');
const client=fs.readFileSync('android/app/src/main/java/il/kidsyoutube/FamilyAuthClient.java','utf8');
test('device playback grants use verified, active device identity and no legacy fallback',()=>{
 const start=edge.indexOf('if(action==="playback-grants")');
 const end=edge.indexOf('if(action==="list")',start);
 assert.ok(start>0&&end>start);
 const code=edge.slice(start,end);
 assert.match(code,/who\.role!=="device"/);
 assert.match(code,/readRow\(who\.familyId\)/);
 assert.match(code,/validateApprovalList\(current\.list\)/);
 assert.match(code,/contract:1/);
 assert.doesNotMatch(code,/kids_youtube_state|body\.familyId|query\.familyId/);
 assert.match(edge,/&revoked_at=is\.null&select=family_id/);
});
test('android calls device-only grants endpoint with the bearer token',()=>{
 assert.match(client,/action","playback-grants"/);
 assert.match(client,/Authorization","Bearer "\+token/);
 assert.match(client,/FAMILY_GRANTS_HTTP_/);
});
