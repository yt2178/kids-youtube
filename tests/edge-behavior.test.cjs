const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {webcrypto,createHash}=require('node:crypto');
const API_ORIGIN='https://yt2178.github.io';
const A='https://www.youtube.com/watch?v=mVTlbvQ_010',B='https://www.youtube.com/watch?v=AAAAAAAAAAA';
const hash=(pass,secret)=>createHash('sha256').update(secret+'\0'+pass).digest('base64url');
async function createFixture({upstream,configured=true}={}){
 const db={list_text:A+'\n',password_hash:configured?hash('familyPassword!','secret123'):null,session_secret:'secret123',version:7,updated_at:'date'};
 let serve,patches=0,conflict=false;const catalog=new Map();
 async function fetcher(input,opts={}){
  const u=new URL(String(input));
  if(u.origin!=='https://test.supabase.co'){
    if(upstream)return upstream(u,opts);
    throw Error('Unexpected outbound fetch: '+u.href);
  }
  if(u.pathname.includes('/kids_youtube_catalog')){
    if(opts.method==='POST'){
      const row=JSON.parse(opts.body);catalog.set(row.approval_url,row);
      return new Response('',{status:201});
    }
    return new Response(JSON.stringify([...catalog.values()]),{status:200});
  }
  if(opts.method==='PATCH'){
    patches++;const expected=Number(u.searchParams.get('version').slice(3));
    if(conflict||expected!==db.version)return new Response('[]',{status:200});
    Object.assign(db,JSON.parse(opts.body));
  }
  return new Response(JSON.stringify([db]),{status:200});
 }
 const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/kids-youtube/index.ts','utf8'),{mode:'strip'});
 const ctx=vm.createContext({Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://test.supabase.co':'servicekey'},serve:f=>serve=f},
 fetch:fetcher,crypto:webcrypto,URL,Request,Response,TextEncoder,TextDecoder,AbortController,DOMException,Uint8Array,ReadableStream,atob,btoa,setTimeout,clearTimeout,console});
 vm.runInContext(source,ctx);
 async function request(action,{method='POST',body,token,origin=API_ORIGIN,query={}}={}){
   const headers={origin};if(token)headers.authorization='Bearer '+token;
   if(body!==undefined)headers['content-type']='application/json';
   const url=new URL('https://function.example.test/?action='+action);
   for(const [key,value] of Object.entries(query))url.searchParams.set(key,value);
   const req=new Request(url,{method,headers,body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
   const res=await serve(req);return {status:res.status,data:await res.json(),headers:res.headers};
 }
 const token=(await request('login',{body:{password:'familyPassword!'}})).data.token;
 return {db,catalog,request,token,patches:()=>patches,conflict:flag=>conflict=flag};
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

test('runtime: correct and incorrect passwords, configured setup and setup activation',async()=>{
  const f=await createFixture();
  assert.equal((await f.request('login',{body:{password:'wrongPassword'}})).status,401);
  assert.equal((await f.request('login',{body:{password:'familyPassword!'}})).status,200);
  assert.equal((await f.request('status',{token:f.token,body:{}})).data.authenticated,true);
  assert.equal((await f.request('setup',{body:{password:'anotherFamilyPassword'}})).status,409);
  const blank=await createFixture({configured:false});
  assert.equal((await blank.request('login',{body:{password:'anything'}})).status,409);
  assert.equal((await blank.request('setup',{body:{password:'abc'}})).status,400);
  assert.equal((await blank.request('setup',{body:{password:'newFamilyPass'}})).status,200);
  assert.ok(blank.db.password_hash);
});
test('runtime: missing, forged, expired and malformed session tokens cannot write or proxy',async()=>{
  const f=await createFixture(),body={operation:'remove',link:A};
  assert.equal((await f.request('mutate',{body})).status,401);
  assert.equal((await f.request('mutate',{token:'malformed',body})).status,401);
  assert.equal((await f.request('mutate',{token:'wrong.payload',body})).status,401);
  assert.equal((await f.request('provider',{method:'GET',query:{target:'https://invidious.f5.si/api/v1/videos/mVTlbvQ_010'}})).status,401);
  const p=f.token.split('.'),corrupted=p[0]+'.'+p[1].slice(0,-2)+'xy';
  assert.equal((await f.request('mutate',{token:corrupted,body})).status,401);
  assert.equal(f.db.list_text,A+'\n');
});
test('runtime: malformed bodies, list values and mutation operations have bounded validation',async()=>{
  const f=await createFixture();
  for(const body of ['{invalid', 'null','[]']){
    assert.equal((await f.request('replace',{token:f.token,body})).status,400);
  }
  assert.equal((await f.request('mutate',{token:f.token,body:{operation:'erase',link:A}})).status,400);
  assert.equal((await f.request('mutate',{token:f.token,body:{operation:'add',link:'https://evil.test/watch?v=mVTlbvQ_010'}})).status,400);
  assert.equal((await f.request('replace',{token:f.token,body:{expectedVersion:7,list:'garbage-url'}})).status,400);
  assert.equal(f.db.list_text,A+'\n');
});
test('runtime: only exact Invidious HTTPS origins and API paths are proxied',async()=>{
  const f=await createFixture({upstream:async()=>new Response('{"videoId":"mVTlbvQ_010"}',{status:200})});
  const invalid=[
    'http://invidious.f5.si/api/v1/videos/mVTlbvQ_010',
    'https://invidious.f5.si.evil.test/api/v1/videos/mVTlbvQ_010',
    'https://evil.test/api/v1/videos/mVTlbvQ_010',
    'https://invidious.f5.si/admin',
    'https://invidious.f5.si/api/v1/stats',
    'https://invidious.f5.si/api/v1/videos/mVTlbvQ_010?unexpected=1',
    'https://invidious.f5.si:444/api/v1/videos/mVTlbvQ_010'
  ];
  for(const target of invalid){
    const r=await f.request('provider',{method:'GET',token:f.token,query:{target}});
    assert.equal(r.status,400,target);
  }
  const ok=await f.request('provider',{method:'GET',token:f.token,query:{target:'https://invidious.f5.si/api/v1/videos/mVTlbvQ_010'}});
  assert.equal(ok.status,200);assert.equal(ok.data.videoId,'mVTlbvQ_010');
});
test('runtime: upstream HTTP 403 and redirects are recognized for fallback and never followed',async()=>{
  let calls=0;
  const f=await createFixture({upstream:async()=>{calls++;return new Response('',{status:calls===1?403:302,headers:{location:'https://evil.test/secret'}});}});
  const target='https://invidious.f5.si/api/v1/videos/mVTlbvQ_010';
  const denied=await f.request('provider',{method:'GET',token:f.token,query:{target}});
  assert.equal(denied.status,200);assert.equal(denied.headers.get('X-Kids-Provider-Status'),'403');
  const redirect=await f.request('provider',{method:'GET',token:f.token,query:{target}});
  assert.equal(redirect.status,200);assert.equal(redirect.headers.get('X-Kids-Provider-Status'),'502');
  assert.equal(redirect.data.error,'UPSTREAM_REDIRECT');assert.equal(calls,2);
});
test('runtime: oversized and malformed upstream bodies return stable errors',async()=>{
  const target='https://invidious.f5.si/api/v1/videos/mVTlbvQ_010';
  for(const [body,error] of [['not valid JSON','UPSTREAM_INVALID'],['X'.repeat(2_000_100),'UPSTREAM_TOO_LARGE']]){
    const f=await createFixture({upstream:async()=>new Response(body)});
    const response=await f.request('provider',{method:'GET',token:f.token,query:{target}});
    assert.equal(response.status,200);assert.equal(response.data.error,error);
    assert.equal(response.headers.get('X-Kids-Provider-Status'),'502');
  }
});
test('runtime: network connection timeout returns a retryable 504 proxy status',async()=>{
  const f=await createFixture({upstream:(_url,{signal})=>new Promise((_,reject)=>{
    signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});
  })});
  const r=await f.request('provider',{method:'GET',token:f.token,query:{target:'https://invidious.f5.si/api/v1/videos/mVTlbvQ_010'}});
  assert.equal(r.status,200);assert.equal(r.headers.get('X-Kids-Provider-Status'),'504');
  assert.equal(r.data.error,'UPSTREAM_TIMEOUT');
});
test('runtime: body-read timeout is also bounded and returns 504',async()=>{
  const f=await createFixture({upstream:(_url,{signal})=>{
    const body=new ReadableStream({start(controller){
      controller.enqueue(new TextEncoder().encode('{"partial":'));
      signal.addEventListener('abort',()=>controller.error(new DOMException('aborted','AbortError')),{once:true});
    }});
    return Promise.resolve(new Response(body,{status:200}));
  }});
  const r=await f.request('provider',{method:'GET',token:f.token,query:{target:'https://invidious.f5.si/api/v1/videos/mVTlbvQ_010'}});
  assert.equal(r.status,200);assert.equal(r.headers.get('X-Kids-Provider-Status'),'504');
});

test('runtime: server-prepared metadata is shared with fresh clients but removed grants hide it',async()=>{
  const f=await createFixture({upstream:async url=>{
    if(url.hostname==='www.youtube.com'&&url.pathname==='/oembed')return new Response(JSON.stringify({title:'Real title',author_name:'Real author'}));
    if(url.pathname.includes('/api/v1/videos/'))return new Response(JSON.stringify({
      videoId:'AAAAAAAAAAA',title:'Prepared title',authorId:'UC'+'A'.repeat(22),published:1234567
    }));
    return new Response('unavailable',{status:403});
  }});
  const add=await f.request('mutate',{token:f.token,body:{operation:'add',link:B}});
  assert.equal(add.status,200);assert.equal(add.data.catalog.prepared,true);
  const fresh=await f.request('list',{method:'GET'});
  assert.equal(fresh.data.catalogVersion,1);
  const catalog=await f.request('catalog',{method:'GET'});
  assert.equal(catalog.status,200);assert.equal(catalog.data.entries.length,1);
  assert.equal(catalog.data.entries[0].title,'Prepared title');
  assert.equal(catalog.data.entries[0].item_id,'AAAAAAAAAAA');
  const removed=await f.request('mutate',{token:f.token,body:{operation:'remove',link:B}});
  assert.equal(removed.status,200);
  assert.equal(f.catalog.size,1,'display cache may survive removal');
  const after=await f.request('catalog',{method:'GET'});
  assert.equal(after.data.entries.length,0,'but it can never authorize removed material');
});
test('runtime: only newly approved handles are pinned to verified stable UC IDs',async()=>{
  const id='UC'+'A'.repeat(22),url='https://www.youtube.com/@newchannel';
  const f=await createFixture({upstream:async target=>{
    if(target.pathname==='/api/v1/resolveurl')return new Response(JSON.stringify({ucid:id}));
    if(target.pathname==='/api/v1/channels/'+id+'/videos')return new Response(JSON.stringify({
      videos:[{videoId:'AAAAAAAAAAA',title:'Child video',authorId:id,published:123}],continuation:null
    }));
    if(target.pathname==='/api/v1/channels/'+id)return new Response(JSON.stringify({author:'New channel',authorThumbnails:[]}));
    return new Response('',{status:404});
  }});
  const added=await f.request('mutate',{token:f.token,body:{operation:'add',link:url}});
  assert.equal(added.data.pinned,true);
  assert.match(f.db.list_text,new RegExp(id));
  assert.doesNotMatch(f.db.list_text,/@newchannel/);
  const rows=(await f.request('catalog',{method:'GET'})).data.entries;
  assert.equal(rows.length,1);assert.equal(rows[0].item_id,id);
  assert.equal(rows[0].page.length,1);
  const old=await createFixture({upstream:async()=>new Response(JSON.stringify({ucid:id}))});
  old.db.list_text=url+'\n';old.db.version++;
  const existing=await old.request('mutate',{token:old.token,body:{operation:'add',link:url}});
  assert.equal(existing.data.changed,false);
  assert.equal(old.db.list_text,url+'\n','existing alias meaning is never rewritten');
});
test('runtime: prepared channel page rejects unverified author identities',async()=>{
  const id='UC'+'A'.repeat(22),url='https://www.youtube.com/channel/'+id;
  const f=await createFixture({upstream:async target=>{
    if(target.pathname.endsWith('/videos'))return new Response(JSON.stringify({videos:[
      {videoId:'AAAAAAAAAAA',title:'untrusted',authorId:''},
      {videoId:'BBBBBBBBBBB',title:'wrong channel',authorId:'UC'+'B'.repeat(22)},
      {videoId:'CCCCCCCCCCC',title:'valid',authorId:id}
    ],continuation:null}));
    if(target.pathname.endsWith(id))return new Response(JSON.stringify({author:'Real channel',authorThumbnails:[]}));
    return new Response('',{status:404});
  }});
  f.db.list_text=url+'\n';
  const prepared=await f.request('prepare',{token:f.token,body:{link:url}});
  assert.equal(prepared.data.prepared,true);
  const page=f.catalog.get(url).page;
  assert.equal(page.length,1);assert.equal(page[0].id,'CCCCCCCCCCC');
});
