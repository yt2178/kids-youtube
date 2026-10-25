const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');

const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DA='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DB='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const F1='11111111-1111-4111-8111-111111111111';
const F2='22222222-2222-4222-8222-222222222222';
const D1='33333333-3333-4333-8333-333333333333';
const D2='44444444-4444-4444-8444-444444444444';
const tokenToId={parentA:A,parentB:B,deviceA:DA,deviceB:DB};
const tokens=Object.fromEntries(Object.keys(tokenToId).map((k,i)=>[k,('x'.repeat(28)+i)]));
function fixture(){
 const approvals=new Map([[F1,{list_text:'https://www.youtube.com/watch?v=abcdefghijk',version:1}],
                           [F2,{list_text:'https://www.youtube.com/watch?v=ABCDEFGHIJK',version:1}]]);
 const devices=new Map([[D1,{id:D1,family_id:F1,auth_user_id:DA,name:'A tablet',revoked_at:null,created_at:'2026-10-20'}],
                        [D2,{id:D2,family_id:F2,auth_user_id:DB,name:'B tablet',revoked_at:null,created_at:'2026-10-20'}]]);
 const familyByOwner=new Map([[A,F1],[B,F2]]);
 let handler;
 const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
 const mockFetch=async(url,init={})=>{
  const u=new URL(url),authorization=new Headers(init.headers||{}).get('authorization')||'';
  if(u.pathname==='/auth/v1/user'){
   const key=Object.keys(tokens).find(k=>'Bearer '+tokens[k]===authorization);
   if(!key)return json({error:'bad token'},401);
   return json({id:tokenToId[key],is_anonymous:key.startsWith('device'),email_confirmed_at:key.startsWith('parent')?'2026-10-20':null});
  }
  const path=u.pathname.replace(/^\/rest\/v1\//,'');
  if(u.pathname.startsWith('/rest/v1/')&&authorization==='Bearer test-service'){
   if(path==='families'){
    const id=u.searchParams.get('owner_id')?.replace('eq.','');
    return json(familyByOwner.has(id)?[{id:familyByOwner.get(id)}]:[]);
   }
   if(path==='devices'){
    const id=u.searchParams.get('auth_user_id')?.replace('eq.','');
    const fam=u.searchParams.get('family_id')?.replace('eq.','');
    const deviceId=u.searchParams.get('id')?.replace('eq.','');
    const rows=[...devices.values()].filter(d=>(!id||d.auth_user_id===id)&&(!fam||d.family_id===fam)&&(!deviceId||d.id===deviceId)&&(!u.searchParams.has('revoked_at')||d.revoked_at===null));
    if(init.method==='PATCH'){
     const body=JSON.parse(init.body);
     for(const d of rows)d.revoked_at=body.revoked_at;
    }
    return json(rows.map(d=>({...d})));
   }
   if(path==='family_approvals'){
    const family=u.searchParams.get('family_id')?.replace('eq.','');
    const entry=approvals.get(family);
    if(!entry)return json([]);
    const expected=u.searchParams.get('version')?.replace('eq.','');
    if(init.method==='PATCH'){
     if(expected!==String(entry.version))return json([]);
     Object.assign(entry,JSON.parse(init.body));
    }
    return json([{...entry}]);
   }
  }
  throw Error('Unexpected mocked request '+u.pathname+u.search);
 };
 const ts=fs.readFileSync('supabase/functions/kids-youtube-family/index.ts','utf8');
 const js=stripTypeScriptTypes(ts);
 const sandbox={Deno:{env:{get:key=>({SUPABASE_URL:'https://tenant-mock.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-service'}[key]||'')},serve:fn=>{handler=fn}},
   fetch:mockFetch,Request,Response,Headers,URL,TextEncoder,crypto:globalThis.crypto,AbortController,setTimeout,clearTimeout,Date,JSON,Set,Object,String,Number,Array,Error,Uint8Array,encodeURIComponent};
 vm.runInNewContext(js,sandbox,{filename:'kids-youtube-family.ts'});
 const call=async(key,action,body)=>{
  const url='https://tenant-mock.invalid/functions/v1/kids-youtube-family?action='+action;
  const req=new Request(url,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+tokens[key],...(body!==undefined?{'content-type':'application/json'}:{})},
   body:body===undefined?undefined:JSON.stringify(body)});
  const response=await handler(req);return {status:response.status,json:await response.json()};
 };
 return {call,approvals,devices};
}

test('parents and paired children only see the server-selected family',async()=>{
 const {call}=fixture();
 for(const [key,expected] of [['parentA','abcdefghijk'],['deviceA','abcdefghijk'],['parentB','ABCDEFGHIJK'],['deviceB','ABCDEFGHIJK']]){
  const r=await call(key,'list');
  assert.equal(r.status,200,key);
  assert.ok(r.json.list.includes(expected),key);
 }
});
test('a child cannot change any list, request pairing codes or enumerate devices',async()=>{
 const {call,approvals}=fixture();
 for(const action of ['replace','create-code','revoke-device']){
  const r=await call('deviceA',action,{list:'',expectedVersion:1,deviceId:D2});
  assert.equal(r.status,403,action);
 }
 assert.equal((await call('deviceA','devices')).status,403);
 assert.equal(approvals.get(F1).version,1);
});
test('parent A cannot revoke parent B device; own-device revoke removes access',async()=>{
 const {call,devices}=fixture();
 const wrong=await call('parentA','revoke-device',{deviceId:D2});
 assert.equal(wrong.status,404);
 assert.equal(devices.get(D2).revoked_at,null);
 const own=await call('parentA','revoke-device',{deviceId:D1});
 assert.equal(own.status,200);
 assert.equal(own.json.revoked,true);
 assert.equal((await call('deviceA','list')).status,403);
 assert.equal((await call('deviceB','list')).status,200);
});
test('stale version and cross-family attempts cannot overwrite another household',async()=>{
 const {call,approvals}=fixture();
 assert.equal((await call('parentA','replace',{list:'',expectedVersion:99,familyId:F2})).status,409);
 assert.equal((await call('parentB','replace',{list:'',expectedVersion:99,familyId:F1})).status,409);
 assert.equal(approvals.get(F1).version,1);
 assert.equal(approvals.get(F2).version,1);
});

test('family catalog only lists explicit approved video IDs for the verified device',async()=>{
 const {call}=fixture();
 const aa=await call('deviceA','catalog-ids');
 const bb=await call('deviceB','catalog-ids');
 assert.equal(aa.status,200);
 assert.equal(bb.status,200);
 assert.deepEqual(Array.from(aa.json.videos),['abcdefghijk']);
 assert.deepEqual(Array.from(bb.json.videos),['ABCDEFGHIJK']);
 assert.equal(aa.json.contract,1);
 assert.equal(aa.json.version,1);
 assert.equal((await call('parentA','catalog-ids')).status,403);
});
test('revoked family device cannot fetch its catalog',async()=>{
 const {call}=fixture();
 assert.equal((await call('parentA','revoke-device',{deviceId:D1})).status,200);
 assert.equal((await call('deviceA','catalog-ids')).status,403);
 assert.equal((await call('deviceB','catalog-ids')).status,200);
});
