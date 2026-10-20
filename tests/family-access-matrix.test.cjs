const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('draft approval table is read-only for client grants until trusted CAS exists',()=>{
 const sql=fs.readFileSync('docs/family-approval-schema-draft.sql','utf8');
 const matrix=fs.readFileSync('docs/FAMILY_ACCESS_TEST_MATRIX.md','utf8');
 assert.match(sql,/enable row level security/);
 assert.match(sql,/revoke all on public\.family_approvals from public, anon, authenticated/);
 assert.match(sql,/grant select on public\.family_approvals to authenticated/);
 assert.doesNotMatch(sql,/grant\s+[^;]*\b(?:insert|update|delete)\b[^;]*to authenticated/i);
 assert.doesNotMatch(sql,/create policy family_approval_(?:insert|update|delete)/i);
 assert.match(sql,/private\.can_read_family\(family_id\)/);
 for(const item of ['Parent A','Parent B','Device A','Revoked device A','Anonymous','expectedVersion'])assert.ok(matrix.includes(item));
});
