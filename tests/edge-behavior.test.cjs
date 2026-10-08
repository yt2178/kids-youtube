const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {webcrypto,createHash}=require('node:crypto');
const API_ORIGIN='https://yt2178.github.io';
const A='https://www.youtube.com/watch?v=mVTlbvQ_010',B='https://www.youtube.com/watch?v=AAAAAAAAAAA';
const hash=(pass,secret)=>createHash('sha256').update(secret+'\0'+pass).digest('base64url');
async function createFixture(){
 const db={list_text:A+'\n',password_hash:hash('familyPassword!','secret123'),session_secret:'secret123',version:7,updated_at:'date'};
 let serve,patches=0,conflict=false;
 async function fetcher(input,opts={}){
  const u=new URL(String(input));
  if(u.origin!=='https://test.supabase.co')throw Error('Unexpected outbound fetch: '+u.href);
  if(opts.method==='PATCH'){
    patches++;const expected=Number(u.searchParams.get('version').slice(3));
    if(conflict||expected!==db.version)return new Response('[]',{status:200});
    Object.assign(db,JSON.parse(opts.body));
  }
  return new Response(JSON.stringify([db]),{status:200});
 }
 const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/kids-youtube/index.ts','utf8'),{mode:'strip'});
 const ctx=vm.createContext({Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://test.supabase.co':'servicekey'},serve:f=>serve=f},
 fetch:fetcher,crypto:webcrypto,URL,Request,Response,TextEncoder,TextDecoder,AbortController,DOMException,Uint8Array,atob,btoa,setTimeout,clearTimeout,console});
 vm.runInContext(source,ctx);
 async function request(action,{method='POST',body,token,origin=API_ORIGIN}={}){
   const headers={origin};if(token)headers.authorization='Bearer '+token;
   if(body!==undefined)headers['content-type']='application/json';
   const req=new Request('https://function.example.test/?action='+action,{method,headers,body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
   const res=await serve(req);return {status:res.status,data:await res.json()};
 }
 const token=(await request('login',{body:{password:'familyPassword!'}})).data.token;
 return {db,request,token,patches:()=>patches,conflict:flag=>conflict=flag};
}
test('stale manual replace cannot overwrite another parent mutation',async()=>{
 const f=await createFixture(),original=await f.request('list',{method:'GET'});
 assert.equal(original.data.version,7);
 const add=await f.request('mutate',{token:f.token,body:{operation:'add',link:B}});
 assert.equal(add.status,200);assert.equal(add.data.version,8);
 const oldPatches=f.patches();
 const stale=await f.request('replace',{token:f.token,body:{list:A+'\n',expectedVersion:7}});
 assert.equal(stale.status,409);assert.equal(stale.data.error,'CONFLICT');
 assert.equal(f.patches(),oldPatches);assert.match(f.db.list_text,/AAAAAAAAAAA/);
 const fresh=await f.request('replace',{token:f.token,body:{list:A+'\n',expectedVersion:8}});
 assert.equal(fresh.status,200);assert.equal(fresh.data.version,9);
 assert.equal(f.db.list_text,A+'\n');
});
test('concurrent patch conflict never retries whole-list snapshot',async()=>{
 const f=await createFixture();f.conflict(true);
 const result=await f.request('replace',{token:f.token,body:{list:B+'\n',expectedVersion:7}});
 assert.equal(result.status,409);assert.equal(f.patches(),1);assert.equal(f.db.list_text,A+'\n');
});
test('manual replace validates version, origin, authentication and JSON shape',async()=>{
 const f=await createFixture();
 for(const v of [undefined,-1,7.5,'7',Number.MAX_SAFE_INTEGER+1]){
  const r=await f.request('replace',{token:f.token,body:{list:B,expectedVersion:v}});
  assert.equal(r.status,400);assert.equal(r.data.error,'EXPECTED_VERSION_REQUIRED');
 }
 assert.equal((await f.request('replace',{body:{list:B,expectedVersion:7}})).status,401);
 assert.equal((await f.request('replace',{token:'bad.token',body:{list:B,expectedVersion:7}})).status,401);
 assert.equal((await f.request('replace',{token:f.token,origin:'https://evil.example',body:{list:B,expectedVersion:7}})).status,403);
 assert.equal((await f.request('replace',{token:f.token,body:'{bad'})).status,400);
 assert.equal(f.db.list_text,A+'\n');
});
test('duplicate add never replaces metadata and existing setup cannot be reset',async()=>{
 const f=await createFixture();
 const dup=await f.request('mutate',{token:f.token,body:{operation:'add',link:A,note:'changed'}});
 assert.equal(dup.data.changed,false);assert.equal(f.db.list_text,A+'\n');
 assert.equal((await f.request('setup',{body:{password:'newPassword!'}})).status,409);
});
