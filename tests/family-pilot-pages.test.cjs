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
