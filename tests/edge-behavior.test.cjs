const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {webcrypto,createHash}=require('node:crypto');
const API_ORIGIN='https://yt2178.github.io';
const A='https://www.youtube.com/watch?v=mVTlbvQ_010',B='https://www.youtube.com/watch?v=AAAAAAAAAAA';
const hash=(pass,secret)=>createHash('sha256').update(secret+'\0'+pass).digest('base64url');
async function createFixture({upstream,configured=true,onCatalogRead,playlistLibrary}={}){
 const db={list_text:A+'\n',password_hash:configured?hash('familyPassword!','secret123'):null,session_secret:'secret123',version:7,updated_at:'date'};
 let serve,patches=0,conflict=false,stateReads=0,catalogReads=0;const catalog=new Map();
 async function fetcher(input,opts={}){
  const u=new URL(String(input));
  if(u.origin!=='https://test.supabase.co'){
    if(upstream)return upstream(u,opts);
    throw Error('Unexpected outbound fetch: '+u.href);
  }
  if(u.pathname.includes('/kids_youtube_catalog')){
    if(opts.method!=='POST'){catalogReads++;if(onCatalogRead)await onCatalogRead(db);}
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
  stateReads++;
  return new Response(JSON.stringify([db]),{status:200});
 }
 const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/kids-youtube/index.ts','utf8'),{mode:'strip'});
 const ctx=vm.createContext({Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://test.supabase.co':'servicekey'},serve:f=>serve=f},
 __playlistLibrary:playlistLibrary,fetch:fetcher,crypto:webcrypto,URL,Request,Response,TextEncoder,TextDecoder,AbortController,DOMException,Uint8Array,ReadableStream,atob,btoa,setTimeout,clearTimeout,console});
 vm.runInContext(source,ctx);
 if(playlistLibrary)vm.runInContext("loadPlaylistLibrary=async()=>__playlistLibrary",ctx);
 async function request(action,{method='POST',body,token,origin=API_ORIGIN,query={}}={}){
   const headers={origin};if(token)headers.authorization='Bearer '+token;
   if(body!==undefined)headers['content-type']='application/json';
   const url=new URL('https://function.example.test/?action='+action);
   for(const [key,value] of Object.entries(query))url.searchParams.set(key,value);
   const req=new Request(url,{method,headers,body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
   const res=await serve(req);return {status:res.status,data:await res.json(),headers:res.headers};
 }
 const token=(await request('login',{body:{password:'familyPassword!'}})).data.token;
 return {db,catalog,request,token,patches:()=>patches,stateReads:()=>stateReads,catalogReads:()=>catalogReads,conflict:flag=>conflict=flag};
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

test('native authoritative list binds server-pinned legacy channel only to currently approved URL',async()=>{
  const f=await createFixture(),handle='https://www.youtube.com/@meirshows';
  f.db.list_text=handle+'\n'+A+'\n';
  f.catalog.set(handle,{approval_url:handle,kind:'channel',item_id:'UCV6xoqUxJzkWwCbDmEwMSYw',checked_at:new Date().toISOString()});
  const first=await f.request('list',{method:'GET',query:{format:'native'}});
  assert.equal(first.status,200);
  assert.equal(first.data.list,f.db.list_text);
  assert.equal(first.data.pinnedChannels.length,1);
  assert.equal(first.data.pinnedChannels[0].url,handle);
  f.db.list_text=A+'\n';
  const revoked=await f.request('list',{method:'GET',query:{format:'native'}});
  assert.deepEqual(JSON.parse(JSON.stringify(revoked.data.pinnedChannels)),[]);
});
test('prepared legacy UC page falls back to a bounded YouTube channel feed when Invidious is unavailable',async()=>{
  const handle='https://www.youtube.com/@meirshows',channel='UCV6xoqUxJzkWwCbDmEwMSYw';
  const feed='<?xml version="1.0"?><feed><title>ערוץ מאיר</title><yt:channelId>'+channel.slice(2)+
    '</yt:channelId><entry><yt:videoId>mVTlbvQ_010</yt:videoId><title>ילד טרמפולינה</title>'+
    '<published>2026-10-01T12:00:00Z</published></entry></feed>';
  const f=await createFixture({upstream:async url=>{
    if(url.pathname==='/feeds/videos.xml')return new Response(feed,{status:200});
    return new Response('',{status:503});
  }});
  f.db.list_text=handle+'\n';
  f.catalog.set(handle,{approval_url:handle,kind:'channel',item_id:channel,page:[],pages_loaded:0,complete:false,checked_at:new Date().toISOString()});
  const result=await f.request('prepare',{token:f.token,body:{link:handle}});
  assert.equal(result.status,200);assert.equal(result.data.prepared,true);
  assert.equal(result.data.count,1);
  assert.equal(f.catalog.get(handle).page[0].title,'ילד טרמפולינה');
  assert.equal(f.catalog.get(handle).page[0].authorId,channel);
  f.db.list_text='';
  const removed=await f.request('catalog',{method:'GET'});
  assert.equal(removed.data.entries.length,0);
});

test('RSS feed from a different UC identity is rejected even if it offers valid-looking videos',async()=>{
  const handle='https://www.youtube.com/@meirshows',channel='UCV6xoqUxJzkWwCbDmEwMSYw';
  const feed='<feed><title>זר</title><yt:channelId>V6xoqUxJzkWwCbDmEwMSYz</yt:channelId>'+
    '<entry><yt:videoId>mVTlbvQ_010</yt:videoId><title>לא מאושר</title></entry></feed>';
  const f=await createFixture({upstream:async url=>
    url.pathname==='/feeds/videos.xml'?new Response(feed,{status:200}):new Response('',{status:503})
  });
  f.db.list_text=handle+'\n';
  f.catalog.set(handle,{approval_url:handle,kind:'channel',item_id:channel,page:[],pages_loaded:0,complete:false,checked_at:new Date().toISOString()});
  const result=await f.request('prepare',{token:f.token,body:{link:handle}});
  assert.equal(result.status,200);
  assert.equal(result.data.reason,'PROVIDER_UNAVAILABLE');
  assert.equal(result.data.prepared,false);
  assert.equal(f.catalog.get(handle).page.length,0);
});

test('cold catalog read prepares one approved empty channel from bounded feed and never grants revoked entries',async()=>{
  const handle='https://www.youtube.com/@meirshows',channel='UCV6xoqUxJzkWwCbDmEwMSYw';
  let feedCount=0;
  const feed='<feed><title>ערוץ מאיר</title><yt:channelId>'+channel+'</yt:channelId>'+
    '<entry><yt:videoId>mVTlbvQ_010</yt:videoId><title>שם מוכן</title>'+
    '<published>2026-10-01T11:00:00Z</published></entry></feed>';
  const f=await createFixture({upstream:async url=>{
    if(url.pathname==='/feeds/videos.xml'){feedCount++;return new Response(feed,{status:200});}
    return new Response('',{status:503});
  }});
  f.db.list_text=handle+'\n';
  f.catalog.set(handle,{approval_url:handle,kind:'channel',item_id:channel,title:'ערוץ מאיר',
    thumbnail:'',published:0,channel_id:channel,page:[],pages_loaded:0,continuation:null,
    complete:false,updated_at:'2026-10-07T10:00:00Z',checked_at:'2026-10-07T10:00:00Z'});
  const first=await f.request('catalog',{method:'GET'});
  assert.equal(first.status,200);assert.equal(first.data.entries[0].page.length,1);
  assert.equal(first.data.entries[0].page[0].authorId,channel);
  assert.equal(feedCount,1);
  const again=await f.request('catalog',{method:'GET'});
  assert.equal(again.data.entries[0].page.length,1);assert.equal(feedCount,1);
  f.db.list_text='';
  const after=await f.request('catalog',{method:'GET'});
  assert.equal(after.data.entries.length,0);
});

test('native list and browser list share the same version, marker and approval text',async()=>{
 const f=await createFixture();
 const native=await f.request('list',{method:'GET',query:{format:'native'}});
 const browser=await f.request('list',{method:'GET'});
 assert.equal(native.status,200);
 assert.equal(native.data.list,browser.data.list);
 assert.equal(native.data.version,browser.data.version);
 assert.equal(native.data.updatedAt,browser.data.updatedAt);
 assert.equal(native.data.catalogVersion,1);
 assert.ok(Array.isArray(native.data.pinnedChannels));
});

test('runtime native authorization embeds existing approved display records without an additional provider request',async()=>{
 const f=await createFixture();
 const now=new Date().toISOString();
 f.catalog.set(A,{approval_url:A,kind:'video',item_id:'mVTlbvQ_010',title:'כותרת מוכנה',checked_at:now,page:[]});
 const response=await f.request('list',{method:'GET',query:{format:'native'}});
 assert.equal(response.status,200);
 assert.equal(response.data.version,7);
 assert.equal(response.data.updatedAt,'date');
 assert.equal(response.data.preparedCatalog.version,7);
 assert.equal(response.data.preparedCatalog.entries.length,1);
 assert.equal(response.data.preparedCatalog.entries[0].title,'כותרת מוכנה');
 assert.equal(response.data.list,A+'\n');
});
test('native authorization filters prepared display cache against current approval list',async()=>{
 const f=await createFixture(),now=new Date().toISOString();
 f.catalog.set(B,{approval_url:B,kind:'video',item_id:'AAAAAAAAAAA',title:'לא מאושר',checked_at:now,page:[]});
 const response=await f.request('list',{method:'GET',query:{format:'native'}});
 assert.equal(response.status,200);
 assert.equal(response.data.preparedCatalog.entries.length,0);
 assert.equal(response.data.list,A+'\n');
});

test('native snapshot refuses revoked grant changed during catalog table read',async()=>{
 let changed=false;
 const f=await createFixture({onCatalogRead:async db=>{
   if(!changed){changed=true;db.list_text='';db.version++;db.updated_at='after-revocation';}
 }});
 f.catalog.set(A,{approval_url:A,kind:'video',item_id:'mVTlbvQ_010',title:'previously approved',checked_at:new Date().toISOString(),page:[]});
 const response=await f.request('list',{method:'GET',query:{format:'native'}});
 assert.equal(response.status,409);
 assert.equal(response.data.error,'AUTH_CHANGED_RETRY');
 assert.equal(response.data.list,undefined);
 assert.equal(response.data.preparedCatalog,undefined);
 const fresh=await f.request('list',{method:'GET',query:{format:'native'}});
 assert.equal(fresh.status,200);
 assert.equal(fresh.data.list,'');
 assert.ok(!fresh.data.preparedCatalog || fresh.data.preparedCatalog.entries.length===0);
});
test('native snapshot never returns an old authority on failed final state verification',async()=>{
 let failed=false;
 const f=await createFixture({onCatalogRead:async db=>{if(!failed){db.updated_at='changed-same-version';failed=true;}}});
 const response=await f.request('list',{method:'GET',query:{format:'native'}});
 assert.equal(response.status,409);
 assert.equal(response.data.error,'AUTH_CHANGED_RETRY');
});
test('native snapshot is bounded and serves catalog in one client request',async()=>{
 const f=await createFixture();
 const now=new Date().toISOString();
 f.catalog.set(A,{approval_url:A,kind:'video',item_id:'mVTlbvQ_010',title:'הכותרת המוכנה',checked_at:now,page:[]});
 const before=f.stateReads(),beforeCatalog=f.catalogReads();
 const response=await f.request('list',{method:'GET',query:{format:'native'}});
 assert.equal(response.status,200);
 assert.equal(response.data.preparedCatalog.entries.length,1);
 assert.equal(response.data.preparedCatalog.version,response.data.version);
 assert.equal(response.data.preparedCatalog.updatedAt,response.data.updatedAt);
 assert.ok(JSON.stringify(response.data).length<800000);
 assert.equal(f.stateReads()-before,2,'two internal authority reads, one external response');
 assert.equal(f.catalogReads()-beforeCatalog,1);
});

test('runtime: compact native polls retain fresh permissions and pins without display payload',async()=>{
  const f=await createFixture(),handle='https://www.youtube.com/@meirshows';
  const id='UC'+'A'.repeat(22);
  f.db.list_text=handle+'\n'+A+'\n';
  f.catalog.set(handle,{approval_url:handle,kind:'channel',item_id:id,
    title:'בדיקת ערוץ',checked_at:new Date().toISOString(),page:[],pages_loaded:1,complete:false});
  const full=await f.request('list',{method:'GET',query:{format:'native'}});
  const compact=await f.request('list',{method:'GET',query:{format:'native',detail:'grants'}});
  assert.equal(full.status,200);
  assert.equal(compact.status,200);
  assert.ok(full.data.preparedCatalog);
  assert.equal(compact.data.preparedCatalog,undefined);
  assert.equal(compact.data.version,full.data.version);
  assert.equal(compact.data.updatedAt,full.data.updatedAt);
  assert.equal(compact.data.list,full.data.list);
  assert.deepEqual(JSON.parse(JSON.stringify(compact.data.pinnedChannels)),
    JSON.parse(JSON.stringify(full.data.pinnedChannels)));
  // Parent revocation must be reflected on the next compact check.
  f.db.version++;
  f.db.list_text=A+'\n';
  const revoked=await f.request('list',{method:'GET',query:{format:'native',detail:'grants'}});
  assert.equal(revoked.data.version,f.db.version);
  assert.equal(revoked.data.list,A+'\n');
  assert.equal(revoked.data.pinnedChannels.length,0);
});

const PL='PLrfcruGtplwHxMQ6Wi2x0uVIrHF9uFcSz',PU='https://www.youtube.com/playlist?list='+PL;
function fakePlaylists(loader){
 return {Log:{setLevel(){},Level:{NONE:0}},Innertube:{create:async()=>({getPlaylist:loader})}};
}
function playlistPage(ids,{next,title='רשימת המשפחה'}={}){
 return {info:{title,author:{name:'Parent'}},items:ids.map(id=>({id,title:'שם '+id,is_playable:true})),has_continuation:!!next,getContinuation:next};
}
test('playlist authority follows live additions/removals without persisting members as parent grants',async()=>{
 let ids=['BBBBBBBBBBB'];let reads=0;
 const f=await createFixture({playlistLibrary:fakePlaylists(async()=>{reads++;return playlistPage(ids);})});
 const add=await f.request('mutate',{token:f.token,body:{operation:'add',link:PU,note:'Family'}});
 assert.equal(add.status,200);assert.match(f.db.list_text,/playlist\?list=/);assert.doesNotMatch(f.db.list_text,/BBBBBBBBBBB/);
 const one=await f.request('list',{method:'GET',query:{format:'native'}});
 assert.match(one.data.list,/BBBBBBBBBBB/);assert.match(one.data.list,/mVTlbvQ_010/);assert.doesNotMatch(one.data.list,/playlist\?/);
 assert.equal(one.data.preparedCatalog.entries.find(v=>v.item_id==='BBBBBBBBBBB').title,'שם BBBBBBBBBBB');
 ids=['CCCCCCCCCCC'];
 const two=await f.request('list',{method:'GET',query:{format:'native',detail:'grants'}});
 assert.doesNotMatch(two.data.list,/BBBBBBBBBBB/);assert.match(two.data.list,/CCCCCCCCCCC/);assert.equal(two.data.version,one.data.version);
 assert.ok(reads>=3);assert.equal(two.data.preparedCatalog,undefined);
 const parent=await f.request('list',{method:'GET'});assert.match(parent.data.list,/playlist\?/);assert.doesNotMatch(parent.data.list,/CCCCCCCCCCC/);
 await f.request('mutate',{token:f.token,body:{operation:'remove',link:PU}});
 const removed=await f.request('list',{method:'GET',query:{format:'native'}});assert.doesNotMatch(removed.data.list,/CCCCCCCCCCC/);
});
test('playlist failure or empty membership grants nothing from that source; direct approvals survive',async()=>{
 let broken=false;
 const f=await createFixture({playlistLibrary:fakePlaylists(async()=>{if(broken)throw Error('upstream');return playlistPage(['mVTlbvQ_010','BBBBBBBBBBB']);})});
 f.db.list_text+=PU+'\n';
 assert.match((await f.request('list',{method:'GET',query:{format:'native'}})).data.list,/BBBBBBBBBBB/);
 broken=true;
 const fail=await f.request('list',{method:'GET',query:{format:'native'}});
 assert.equal(fail.status,200);assert.match(fail.data.list,/mVTlbvQ_010/);assert.doesNotMatch(fail.data.list,/BBBBBBBBBBB/);assert.equal(fail.data.unavailablePlaylists.length,1);
});
test('playlist fully follows continuations; incomplete later page never approves first page',async()=>{
 let fail=false;
 const f=await createFixture({playlistLibrary:fakePlaylists(async()=>playlistPage(['BBBBBBBBBBB'],{next:async()=>{if(fail)throw Error('page2');return playlistPage(['CCCCCCCCCCC']);}}))});
 f.db.list_text=PU+'\n';
 const good=await f.request('list',{method:'GET',query:{format:'effective'}});
 assert.match(good.data.list,/BBBBBBBBBBB/);assert.match(good.data.list,/CCCCCCCCCCC/);
 fail=true;const bad=await f.request('list',{method:'GET',query:{format:'native'}});assert.equal(bad.data.list,'');assert.equal(bad.data.unavailablePlaylists.length,1);
});
test('playlist empty is a successful empty authorization, not a stale snapshot',async()=>{
 const f=await createFixture({playlistLibrary:fakePlaylists(async()=>playlistPage([]))});f.db.list_text=PU+'\n';
 const r=await f.request('list',{method:'GET',query:{format:'native'}});assert.equal(r.data.list,'');assert.equal(r.data.unavailablePlaylists.length,0);
});
test('parent removal during playlist lookup returns conflict, not the old grant',async()=>{
 let fixture;
 const f=fixture=await createFixture({playlistLibrary:fakePlaylists(async()=>{fixture.db.list_text='';fixture.db.version++;return playlistPage(['BBBBBBBBBBB']);})});f.db.list_text=PU+'\n';
 for(const format of ['native','effective']){f.db.list_text=PU+'\n';const r=await f.request('list',{method:'GET',query:{format}});assert.equal(r.status,409);assert.equal(r.data.error,'AUTH_CHANGED_RETRY');}
});
test('playlist source validation rejects private/unavailable, over-limit and unsafe targets before writes',async()=>{
 const f=await createFixture({playlistLibrary:fakePlaylists(async()=>{throw Error('private');})});
 const before=f.patches();
 assert.equal((await f.request('mutate',{token:f.token,body:{operation:'add',link:PU}})).data.error,'PLAYLIST_UNAVAILABLE');
 for(const link of ['https://youtube.com/playlist?list=WL','https://youtube.com/playlist?list=RDabcdefghijk','https://evil.example/playlist?list='+PL,'https://youtube.com/playlist?list='+PL+'&list='+PL])assert.equal((await f.request('mutate',{token:f.token,body:{operation:'add',link}})).status,400);
 assert.equal((await f.request('mutate',{body:{operation:'add',link:PU}})).status,401);assert.equal(f.patches(),before);
});
test('playlist size is bounded and no partial oversized playlist becomes a grant',async()=>{
 const f=await createFixture({playlistLibrary:fakePlaylists(async()=>playlistPage(Array(501).fill('BBBBBBBBBBB')))});
 assert.equal((await f.request('metadata',{token:f.token,body:{link:PU}})).data.error,'PLAYLIST_TOO_LARGE');
 f.db.list_text=PU+'\n';assert.equal((await f.request('list',{method:'GET',query:{format:'native'}})).data.list,'');
 const list=Array.from({length:4},(_,i)=>PU+i).join('\n');
 assert.equal((await f.request('replace',{token:f.token,body:{list,expectedVersion:f.db.version}})).status,400);
});
test('multiple playlist overlap and direct approval are deduplicated without losing independent permission',async()=>{
 const f=await createFixture({playlistLibrary:fakePlaylists(async id=>playlistPage(id===PL?['mVTlbvQ_010','BBBBBBBBBBB']:['BBBBBBBBBBB']))});
 f.db.list_text+=PU+'\n'+PU+'1\n';
 let r=await f.request('list',{method:'GET',query:{format:'native'}});assert.equal((r.data.list.match(/BBBBBBBBBBB/g)||[]).length,2); // URL + display note
 f.db.list_text=A+'\n'+PU+'1\n';r=await f.request('list',{method:'GET',query:{format:'native'}});assert.match(r.data.list,/BBBBBBBBBBB/);assert.match(r.data.list,/mVTlbvQ_010/);
});
test('playlist parser reads items only, rejects foreign LockupView and never approves recommendations',async()=>{
 let foreign=false;
 const f=await createFixture({playlistLibrary:fakePlaylists(async()=>({info:{title:'test'},items:[{type:'LockupView',content_id:'BBBBBBBBBBB',content_type:'VIDEO',metadata:{title:'Member'},renderer_context:{command_context:{on_tap:{payload:{playlistId:foreign?'OTHER':PL}}}}}],videos:[{id:'CCCCCCCCCCC'}],has_continuation:false}))});
 f.db.list_text=PU+'\n';let r=await f.request('list',{method:'GET',query:{format:'native'}});assert.match(r.data.list,/BBBBBBBBBBB/);assert.doesNotMatch(r.data.list,/CCCCCCCCCCC/);
 foreign=true;r=await f.request('list',{method:'GET',query:{format:'native'}});assert.equal(r.data.list,'');
});
