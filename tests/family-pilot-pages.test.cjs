const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('the experimental family login page is packaged for GitHub Pages',()=>{
 const yml=fs.readFileSync('.github/workflows/pages.yml','utf8');
 const copy=yml.split('\n').find(x=>x.trim().startsWith('cp index.html '));
 assert.ok(copy,'explicit published-file list missing');
 for(const name of ['family-pilot.html','family-pilot.js']){
  assert.ok(copy.split(/\s+/).includes(name),name+' omitted from Pages artifact');
  assert.ok(fs.existsSync(name),name+' source not found');
 }
 assert.match(yml,/upload-pages-artifact@v3/);
});

test('pairing guidance accurately describes debug-only Android availability',()=>{
 const html=fs.readFileSync('family-pilot.html','utf8');
 assert.match(html,/מסך הזנת הקוד קיים כרגע בגרסת Debug/);
 assert.match(html,/הנגן הפעיל עדיין אינו משתמש באישורים המשפחתיים/);
 assert.doesNotMatch(html,/עדיין אין באפליקציית הילדים מסך להזנת קוד זה/);
});

test('invite completion requires verified invite token and removes secrets from URL',()=>{
 const js=fs.readFileSync('family-invite-complete.js','utf8');
 const html=fs.readFileSync('family-invite-complete.html','utf8');
 const yml=fs.readFileSync('.github/workflows/pages.yml','utf8');
 assert.match(yml,/family-invite-complete.html family-invite-complete.js _site\//);
 assert.match(js,/history\.replaceState\(null,'',location\.pathname\)/);
 assert.match(js,/type!=='invite'/);
 assert.match(js,/user\.email_confirmed_at/);
 assert.match(js,/authRequest\('PUT','\/auth\/v1\/user',accessToken,\{password:pw\.value\}\)/);
 assert.match(js,/window\.addEventListener\('pagehide',clearSensitive\)/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|console\.log/);
 assert.match(html,/autocomplete="new-password"/);
 assert.doesNotMatch(html,/\/auth\/v1\/signup/);
});
