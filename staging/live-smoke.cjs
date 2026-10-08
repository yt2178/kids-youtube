// Read-only live staging acceptance: never writes to the family or staging tables.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const STAGE='https://jxhelpxhrmwvzrrfrjuh.supabase.co/functions/v1/kids-youtube-staging';
const ORIGIN='https://kids-youtube-audit-staging.onrender.com';
const PRODUCTION='https://jxhelpxhrmwvzrrfrjuh.supabase.co/functions/v1/kids-youtube';
const EXPECTED='https://www.youtube.com/watch?v=jfKfPfyJRdk';
async function request(url,init={}){
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),13000);
  try{return await fetch(url,{...init,signal:ctrl.signal,headers:{Origin:ORIGIN,...init.headers}});}
  finally{clearTimeout(timer);}
}
async function main(){
  const sha=process.env.KIDS_BUILD_SHA||'';
  assert.match(sha,/^[a-f0-9]{40}$/);
  const folder=path.resolve('staging-dist');
  const build=JSON.parse(fs.readFileSync(path.join(folder,'build.json'),'utf8'));
  assert.equal(build.candidateSha,sha);
  for(const filename of ['app.js','parents.js','index.html']){
    const source=fs.readFileSync(path.join(folder,filename),'utf8');
    assert.equal(source.split(PRODUCTION).slice(1).some(suffix=>!suffix.startsWith('-staging')),false,filename+' production endpoint');
    assert.equal(source.includes(STAGE),true,filename+' staging endpoint');
  }
  const listResponse=await request(STAGE+'?action=list');
  assert.equal(listResponse.status,200);
  assert.equal(listResponse.headers.get('access-control-allow-origin'),ORIGIN);
  const list=await listResponse.json();
  assert.equal(list.catalogVersion,1);assert.equal(typeof list.version,'number');
  assert.ok(list.list.includes(EXPECTED),'staging is seeded with an independent test approval');
  const catalogResponse=await request(STAGE+'?action=catalog');
  assert.equal(catalogResponse.status,200);
  const catalog=await catalogResponse.json();
  assert.equal(catalog.version,list.version);assert.equal(catalog.updatedAt,list.updatedAt);
  assert.ok(catalog.entries.some(e=>e.approval_url===EXPECTED&&e.title.includes('STAGING FIXTURE')));
  assert.equal(catalog.entries.some(e=>e.item_id==='AAAAAAAAAAA'),false,
    'unapproved staging catalog entries must not leak into a fresh client');
  const anon=await request(STAGE+'?action=mutate',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({operation:'remove',link:EXPECTED})
  });
  assert.equal(anon.status,401);
  const forged=await request(STAGE+'?action=login',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({password:'not-the-password'})
  });
  assert.equal(forged.status,401);
  const login=await request(STAGE+'?action=login',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({password:'KidsStageOnly!2026'})
  });
  assert.equal(login.status,200);
  const session=await login.json();assert.match(session.token,/^[^.]+\.[^.]+$/);
  const status=await request(STAGE+'?action=status',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.token},body:'{}'
  });
  assert.equal(status.status,200);assert.equal((await status.json()).authenticated,true);
  const noReset=await request(STAGE+'?action=setup',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({password:'attacker'})
  });
  assert.equal(noReset.status,409);
  console.log('STAGING LIVE PASS SHA='+sha+' grantVersion='+list.version+
   ' catalogEntries='+catalog.entries.length+' unapprovedFiltered=true auth=true');
}
main().catch(e=>{console.error('STAGING LIVE FAILED:',e);process.exitCode=1;});
