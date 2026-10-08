const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {build,validate}=require('../staging/build-static.cjs');
const prod='https://jxhelpxhrmwvzrrfrjuh.supabase.co/functions/v1/kids-youtube';
const candidate='https://separate-staging-test.supabase.co/functions/v1/kids-youtube';
test('isolated PWA build refuses production, arbitrary and non-HTTPS backends',()=>{
 for(const value of [prod,'http://other.supabase.co/functions/v1/kids-youtube','https://example.com/api',
   'https://foo.supabase.co/functions/v1/kids-youtube?x=1',undefined]){
   assert.throws(()=>validate(value),/STAGING_BACKEND_URL/);
 }
});
test('staging bundle uses a disjoint API host and browser storage namespace',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'kids-pwa-test-'));
 try{
  const dist=build(candidate,temp),names=['index.html','app.js','parents.html','parents.js','sw.js'];
  for(const file of names){
    const text=fs.readFileSync(path.join(dist,file),'utf8');
    assert.doesNotMatch(text,/jxhelpxhrmwvzrrfrjuh/);
  }
  assert.match(fs.readFileSync(path.join(dist,'app.js'),'utf8'),/separate-staging-test\.supabase\.co/);
  assert.match(fs.readFileSync(path.join(dist,'parents.js'),'utf8'),/kidsStagingParentToken/);
  assert.doesNotMatch(fs.readFileSync(path.join(dist,'parents.js'),'utf8'),/['"]kidsParentToken['"]/);
  assert.match(fs.readFileSync(path.join(dist,'sw.js'),'utf8'),/kids-youtube-staging-shell/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dist,'build.json'),'utf8')).staging,true);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
