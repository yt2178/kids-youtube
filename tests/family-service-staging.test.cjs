const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fn=fs.readFileSync('supabase/functions/kids-youtube-family/index.ts','utf8');
const sql=fs.readFileSync('supabase/migrations/20261020_family_approvals_isolated.sql','utf8');
test('family service authenticates using Supabase Auth and ignores supplied family identifiers',()=>{
 assert.match(fn,/auth\/v1\/user/);
 assert.match(fn,/owner_id=eq\./);
 assert.match(fn,/auth_user_id=eq\./);
 assert.match(fn,/revoked_at=is\.null/);
 assert.match(fn,/who\.familyId/);
 assert.doesNotMatch(fn,/body\.familyId|body\.family_id|req\.headers\.get\(["']x-family/i);
 assert.doesNotMatch(fn,/kids_youtube_state|session_secret|password_hash/);
});
test('family service requires parent and uses version-constrained update',()=>{
 assert.match(fn,/who\.role!=="parent"/);
 assert.match(fn,/version=eq\./);
 assert.match(fn,/expectedVersion\+1/);
 assert.match(fn,/VERSION_CONFLICT/);
 assert.match(fn,/rows\.length!==1/);
 assert.match(fn,/identity\.isAnonymous\|\|!identity\.confirmed/);
 assert.match(fn,/!identity\.isAnonymous&&identity\.confirmed/);
 assert.match(fn,/revoked_at=is\.null/);
 assert.match(fn,/email_confirmed_at/);
});
test('family table is additive with RLS and no client grants',()=>{
 assert.match(sql,/create table if not exists public\.family_approvals/);
 assert.match(sql,/enable row level security/);
 assert.match(sql,/revoke all on public\.family_approvals from public, anon, authenticated/);
 assert.doesNotMatch(sql,/\bgrant\b[^;]+\bto\s+(?:anon|authenticated)/i);
 assert.doesNotMatch(sql,/\b(?:drop|truncate|delete from|update)\s+(?:table\s+)?public\.kids_youtube_state/i);
});
