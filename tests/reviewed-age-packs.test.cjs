const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20261022_human_reviewed_age_packs.sql','utf8');
const edge=fs.readFileSync('supabase/functions/kids-youtube-family/index.ts','utf8');
const ui=fs.readFileSync('family-pilot.js','utf8');
const html=fs.readFileSync('family-pilot.html','utf8');
test('age library is private and explicitly reviewed before any approval',()=>{
 assert.match(sql,/review_state text not null default 'candidate'/);
 assert.match(sql,/reviewed_at is not null/);
 assert.match(sql,/length\(btrim\(review_note\)\) >= 20/);
 assert.match(sql,/revoke all on public\.kids_age_pack_items from public,anon,authenticated/);
 for(const band of ['0-3','3-6','6-10','10-13'])assert.ok(sql.includes("'"+band+"'"));
 assert.doesNotMatch(sql,/insert into public\.kids_age_pack_items/);
});
test('family copy of reviewed pack requires parent, nonempty review and version CAS',()=>{
 const action=edge.slice(edge.indexOf('if(action==="age-packs")'),edge.indexOf('if(action==="create-code")'));
 assert.match(action,/review_state=eq\.approved/);
 assert.match(action,/who\.role!=="parent"/);
 assert.match(action,/items\.length<1/);
 assert.match(action,/&version=eq\./);
 assert.match(action,/expectedVersion/);
 assert.match(action,/validateApprovalList\(list\)/);
 assert.doesNotMatch(action,/body\.familyId|body\.family_id|kids_youtube_state/);
});
test('pilot requires confirmation and does not enable empty age packs',()=>{
 assert.match(html,/id="age-packs-area" hidden/);
 assert.match(html,/id="apply-age-pack" type="button" disabled/);
 assert.match(ui,/renderAgePack/);
 assert.match(ui,/action=apply-age-pack/);
 assert.match(ui,/!Array\.isArray\(items\)\|\|!items\.length/);
 assert.match(ui,/if\(!confirm\(/);
});
