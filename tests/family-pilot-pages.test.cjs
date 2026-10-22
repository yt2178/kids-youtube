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
