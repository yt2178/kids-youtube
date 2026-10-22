const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const edge=fs.readFileSync('supabase/functions/kids-youtube-family/index.ts','utf8');
const html=fs.readFileSync('family-pilot.html','utf8');
const ui=fs.readFileSync('family-pilot.js','utf8');
test('pilot invitations require email_verified_at evidence, not a generic confirmed account',()=>{\n assert.match(edge,/if\(!profile\.email_confirmed_at\)return \"\"/);\n});\ntest('devices can only be listed and revoked by verified parents',()=>{
 const list=edge.slice(edge.indexOf('if(action==="devices")'),edge.indexOf('if(action==="create-code")'));
 assert.match(list,/who\.role!=="parent"/);
 assert.match(list,/family_id=eq\./);
 assert.match(list,/revoke-device/);
 assert.match(list,/&revoked_at=is\.null/);
 assert.match(list,/deviceId/);
 assert.match(list,/rows\.length!==1/);
 assert.doesNotMatch(list,/body\.familyId|body\.family_id|kids_youtube_state/);
});
test('device management renders text safely and requests explicit confirmation',()=>{
 assert.match(html,/id="devices-area" hidden/);
 assert.match(ui,/action=devices/);
 assert.match(ui,/action=revoke-device/);
 assert.match(ui,/deviceId:device\.id/);
 assert.match(ui,/document\.createElement/);
 assert.match(ui,/name\.textContent/);
 assert.match(ui,/if\(!confirm\(/);
 assert.doesNotMatch(ui,/device\.name\s*\+\s*['"]<|innerHTML\s*=\s*device/);
});
