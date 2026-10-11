const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const CHANNEL='UCV6xoqUxJzkWwCbDmEwMSYw';
async function fixture({authenticated=true,upstreamStatus=200,items=[{id:'AAAAAAAAAAA',title:'Title',author:{name:'Author'}}],channels=[],continuation=false,failTypes=[]}={}){
 let handler,imports=0,searches=[],pages=0,options;const calls=[];
 const videoResults={videos:items,has_continuation:continuation,getContinuation:async()=>{pages++;return videoResults;}};
 const channelResults={channels,has_continuation:false};
 const lib={Log:{Level:{NONE:0},setLevel(){}},Innertube:{create:async opts=>{
  options=opts;return {search:async(q,filter)=>{
   const type=filter.type;searches.push(type);
   if(failTypes.includes(type))throw Error('upstream '+type);
   return type==='channel'?channelResults:videoResults;
  }};
 }}};
 const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/kids-youtube-search/index.ts','utf8'),{mode:'strip'}).replace('import("npm:youtubei.js@18.1.0/web")','getLibrary()');
 const context=vm.createContext({Deno:{env:{get:()=> 'https://test.supabase.co'},serve:fn=>handler=fn},getLibrary:()=>{imports++;return Promise.resolve(lib);},fetch:async(input,opts)=>{calls.push({input,opts});return new Response(JSON.stringify({authenticated}),{status:upstreamStatus});},URL,Request,Response,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout});vm.runInContext(source,context);
 return {calls,stats:()=>({imports,searches,pages}),options:()=>options,request:async(body={query:'song'},authorization='Bearer test',origin='https://yt2178.github.io')=>{
  const r=await handler(new Request('https://function.test',{method:'POST',headers:{authorization,origin},body:JSON.stringify(body)}));
  return {status:r.status,data:await r.json()};
 }};
}
test('key-free search authenticates parent and returns videos plus a stable result type',async()=>{
 const f=await fixture();const r=await f.request();
 assert.equal(r.status,200);
 assert.deepEqual(r.data.items,[{kind:'video',id:'AAAAAAAAAAA',title:'Title',author:'Author'}]);
 assert.deepEqual(f.stats().searches.sort(),['channel','video']);
 assert.equal(f.calls[0].input,'https://test.supabase.co/functions/v1/kids-youtube?action=status');
 assert.equal(f.calls[0].opts.headers.authorization,'Bearer test');
 assert.equal(f.options().retrieve_player,false);
 assert.equal(f.options().enable_safety_mode,true);
});
test('unapproved, expired and foreign-origin requests never search YouTube',async()=>{
 const f=await fixture({authenticated:false});
 assert.equal((await f.request()).status,401);
 assert.equal((await f.request({},'')).status,401);
 assert.equal((await f.request({},'Bearer test','https://evil.test')).status,403);
 assert.equal(f.stats().imports,0);
});
test('invalid search input and backend authentication errors cannot grant access',async()=>{
 const f=await fixture({upstreamStatus:503});
 assert.equal((await f.request()).status,503);assert.equal(f.stats().searches.length,0);
 for(const body of [null,{}, {query:'x'.repeat(121)},{query:'x',pageToken:'4'},{query:'x',pageToken:'https://evil.test'}])
  assert.equal((await f.request(body)).status,400);
});
test('channels are returned first, with stable UC IDs and strictly validated Google avatar',async()=>{
 const f=await fixture({
  items:[{id:'AAAAAAAAAAA',title:'ברדק שיר',author:{name:'ברדק'}}],
  channels:[
   {id:CHANNEL,author:{name:'ברדק',thumbnails:[{url:'https://yt3.googleusercontent.com/channel-avatar'}]}},
   {id:CHANNEL,author:{name:'Duplicate'}},
   {id:'bad',author:{name:'Invalid'}},
   {id:'UCaaaaaaaaaaaaaaaaaaaaaa',author:{name:'Not safe',thumbnails:[{url:'https://evil.example/tracker.png'}]}}
  ]
 });
 const r=await f.request({query:'ברדק'});
 assert.equal(r.status,200);
 assert.deepEqual(r.data.items.map(x=>x.kind),['channel','channel','video']);
 assert.equal(r.data.items[0].id,CHANNEL);
 assert.equal(r.data.items[0].title,'ברדק');
 assert.equal(r.data.items[0].thumbnail,'https://yt3.googleusercontent.com/channel-avatar');
 assert.equal(r.data.items[1].thumbnail,'');
 assert.equal(r.data.items[2].title,'ברדק שיר');
});
test('newer node shapes, deduplication and invalid video IDs are handled without HTML injection',async()=>{
 const f=await fixture({items:[{id:'AAAAAAAAAAA',title:'<script>literal</script>'},{id:'AAAAAAAAAAA'},{id:'bad'},{content_id:'BBBBBBBBBBB',content_type:'VIDEO',metadata:{title:'New layout'}},{content_id:'CCCCCCCCCCC',content_type:'PLAYLIST'}]});
 const r=await f.request();assert.deepEqual(r.data.items.map(x=>x.id),['AAAAAAAAAAA','BBBBBBBBBBB']);assert.equal(r.data.items[0].title,'<script>literal</script>');
});
test('continuation pages search videos only and stop after three pages',async()=>{
 const f=await fixture({continuation:true,channels:[{id:CHANNEL,author:{name:'ברדק'}}]});
 assert.equal((await f.request({query:'song',pageToken:'3'})).data.nextPageToken,'');
 assert.equal(f.stats().pages,2);assert.deepEqual(f.stats().searches,['video']);
 const g=await fixture();
 assert.deepEqual((await g.request({query:'song',pageToken:'2'})).data,{items:[],nextPageToken:''});
 assert.equal(g.stats().pages,0);
});
test('if channel lookup fails, usable video search results remain visible as partial results',async()=>{
 const f=await fixture({failTypes:['channel']});
 const r=await f.request();
 assert.equal(r.status,200);assert.equal(r.data.partial,true);assert.equal(r.data.items[0].kind,'video');
});
test('if video lookup fails, channels remain visible rather than an empty error',async()=>{
 const f=await fixture({channels:[{id:CHANNEL,author:{name:'ברדק'}}],failTypes:['video']});
 const r=await f.request();
 assert.equal(r.status,200);assert.equal(r.data.partial,true);
 assert.equal(r.data.items[0].kind,'channel');
 assert.equal(r.data.nextPageToken,'');
});
test('if both provider searches fail, return a bounded temporary error',async()=>{
 const f=await fixture({failTypes:['video','channel']});
 assert.equal((await f.request()).status,503);
});
test('YouTube library fetch cannot access other sites or follow redirects',async()=>{
 const f=await fixture();await f.request();
 await assert.rejects(()=>f.options().fetch('https://evil.test'),/SEARCH_TARGET_DENIED/);
 await f.options().fetch('https://www.youtube.com/youtubei/v1/search',{method:'POST'});
 const call=f.calls.at(-1);assert.equal(call.opts.redirect,'error');assert.equal(call.opts.headers,undefined);
});

test('channel avatars fall back from empty author arrays to best_thumbnail and metadata avatar',async()=>{
 const id1='UC'+'B'.repeat(22),id2='UC'+'C'.repeat(22),id3='UC'+'D'.repeat(22);
 const f=await fixture({channels:[
  {id:id1,author:{name:'Channel B',thumbnails:[]},best_thumbnail:{url:'https://yt3.ggpht.com/cover-b'}},
  {id:id2,author:{name:'Channel C',thumbnails:[]},metadata:{avatar:[{url:'https://yt3.googleusercontent.com/cover-c'}]}},
  {id:id3,author:{name:'Channel D',thumbnails:[]},thumbnail:{url:'https://evil.test/hidden'}}
 ]});
 const result=await f.request({query:'channels'});
 assert.equal(result.status,200);
 const items=result.data.items.filter(x=>x.kind==='channel');
 assert.equal(items[0].thumbnail,'https://yt3.ggpht.com/cover-b');
 assert.equal(items[1].thumbnail,'https://yt3.googleusercontent.com/cover-c');
 assert.equal(items[2].thumbnail,'');
});
