const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('family approvals draft cannot mutate singleton and enforces isolation',()=>{
 const sql=fs.readFileSync('docs/family-approval-schema-draft.sql','utf8');
 const plan=fs.readFileSync('docs/FAMILY_ISOLATION_PLAN.md','utf8');
 assert.match(sql,/family_id uuid primary key references public\.families\(id\)/);
 assert.match(sql,/enable row level security/);
 assert.match(sql,/revoke all on public\.family_approvals from public, anon, authenticated/);
 assert.match(sql,/private\.is_parent\(family_id\)/);
 assert.match(sql,/private\.can_read_family\(family_id\)/);
 assert.doesNotMatch(sql,/\b(?:update|delete|drop|truncate|alter)\s+(?:table\s+)?public\.kids_youtube_state\b/i);
 assert.doesNotMatch(sql,/\bdrop\s+policy\b/i);
 assert.match(plan,/DO NOT APPLY|not deployed|not an automatically applied migration/i);
 assert.match(plan,/cross-family tests/i);
});
