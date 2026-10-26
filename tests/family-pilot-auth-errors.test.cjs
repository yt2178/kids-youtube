const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('family-pilot.js','utf8');
test('setup UI is shown only when identity has no family',()=>{
 const begin=source.indexOf('async function getList()');
 const end=source.indexOf('async function guarded(',begin);
 const handler=source.slice(begin,end);
 assert.match(handler,/e\.httpStatus===403&&e\.message==='NO_FAMILY'/);
 assert.doesNotMatch(handler,/e\.httpStatus===403\|\|e\.httpStatus===404/);
 assert.doesNotMatch(handler,/view\('setup'\).*e\.httpStatus===404/);
});
test('closed invitation-only enrollment explains refusal without claiming success',()=>{
 assert.match(source,/e\.message==='ENROLLMENT_CLOSED'/);
 assert.match(source,/e\.message==='INVITATION_REQUIRED'/);
});

test('expired family session clears authorization state and returns to login',()=>{
 const begin=source.indexOf('async function guarded(fn)');
 const end=source.indexOf('els.login.addEventListener',begin);
 const handler=source.slice(begin,end);
 assert.match(handler,/if\(e\.httpStatus===401\)\{token='';version=0;els\.approvals\.value='';els\.password\.value='';view\('login'\);\}/);
});
