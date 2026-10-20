const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20261020_family_device_pairing.sql','utf8');
const edge=fs.readFileSync('supabase/functions/kids-youtube-family/index.ts','utf8');
const ui=fs.readFileSync('family-pilot.html','utf8'),js=fs.readFileSync('family-pilot.js','utf8');
test('pairing code is one use, expiring and securely resolved on server',()=>{
 assert.match(sql,/create table if not exists public\.family_pair_codes/);
 assert.match(sql,/consumed_at is null and expires_at>now\(\)/);
 assert.match(sql,/for update/);
 assert.match(sql,/update public\.family_pair_codes set consumed_at=now\(\)/);
 assert.match(sql,/revoke all on public\.family_pair_codes from public, anon, authenticated/);
 assert.match(sql,/revoke all on function public\.claim_family_pairing\(text,uuid,text\) from public,anon,authenticated/);
 assert.match(sql,/grant execute on function public\.claim_family_pairing\(text,uuid,text\) to service_role/);
 assert.match(edge,/identity\.isAnonymous/);
 assert.match(edge,/already\.length/);
 assert.match(edge,/who\.role!=="parent"/);
 assert.match(edge,/sha256hex\(code\)/);
 assert.match(edge,/crypto\.getRandomValues/);
 assert.match(edge,/\/rest\/v1\/rpc\/claim_family_pairing/);
 assert.doesNotMatch(edge,/kids_youtube_state/);
});
test('pilot shows codes only when parent editor is active',()=>{
 assert.match(ui,/id="pairing-area" hidden/);
 assert.match(js,/\['pairing-area'\]\.hidden=part!=='editor'/);
 assert.match(js,/kids-youtube-family\?action=create-code/);
});
