const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
async function fixture({authenticated=true,upstreamStatus=200,items=[{id:'AAAAAAAAAAA',title:'Title',author:{name:'Author'}}],continuation=false}={}){
 let handler,imports=0,searches=0,pages=0,options;const calls=[];
 const result={videos:items,has_continuation:continuation,getContinuation:async()=>{pages++;return result;}};
 const lib={Log:{Level:{NONE:0},setLevel(){}},Innertube:{create:async opts=>{options=opts;return {search:async(q,filter)=>{searches++;assert.deepEqual(JSON.parse(JSON.stringify(filter)),{type:'video'});return result;}}}}};
 const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/kids-youtube-search/index.ts','utf8'),{mode:'strip'}).replace('import("npm:youtubei.js@18.1.0/web")','getLibrary()');
 const context=vm.createContext({Deno:{env:{get:()=> 'https://test.supabase.co'},serve:fn=>handler=fn},getLibrary:()=>{imports++;return Promise.resolve(lib);},fetch:async(input,opts)=>{calls.push({input,opts});return new Response(JSON.stringify({authenticated}),{status:upstreamStatus});},URL,Request,Response,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout});vm.runInContext(source,context);
 return {calls,stats:()=>({imports,searches,pages}),options:()=>options,request:async(body={query:'song'},authorization='Bearer test',origin='https://yt2178.github.io')=>{const r=await handler(new Request('https://function.test',{method:'POST',headers:{authorization,origin},body:JSON.stringify(body)}));return {status:r.status,data:await r.json()};}};
}
test('key-free search delegates parent auth before contacting YouTube',async()=>{
 const f=await fixture();const r=await f.request();assert.equal(r.status,200);assert.deepEqual(r.data.items,[{id:'AAAAAAAAAAA',title:'Title',author:'Author'}]);
 assert.equal(f.calls[0].input,'https://test.supabase.co/functions/v1/kids-youtube?action=status');assert.equal(f.calls[0].opts.headers.authorization,'Bearer test');assert.equal(f.options().retrieve_player,false);assert.equal(f.options().enable_safety_mode,true);
});
test('unauthorized, expired and cross-origin requests cannot search',async()=>{
 const f=await fixture({authenticated:false});assert.equal((await f.request()).status,401);assert.equal((await f.request({},'')).status,401);assert.equal((await f.request({},'Bearer test','https://evil.test')).status,403);assert.equal(f.stats().imports,0);
});
test('search errors and invalid inputs never grant access',async()=>{
 const f=await fixture({upstreamStatus:503});assert.equal((await f.request()).status,503);assert.equal(f.stats().searches,0);
 for(const body of [null,{}, {query:'x'.repeat(121)},{query:'x',pageToken:'4'},{query:'x',pageToken:'https://evil.test'}])assert.equal((await f.request(body)).status,400);
});
test('search normalizes Video/LockupView, drops invalid IDs and duplicates',async()=>{
 const f=await fixture({items:[{id:'AAAAAAAAAAA',title:'<script>literal</script>'},{id:'AAAAAAAAAAA'},{id:'bad'},{content_id:'BBBBBBBBBBB',content_type:'VIDEO',metadata:{title:'New layout'}},{content_id:'CCCCCCCCCCC',content_type:'PLAYLIST'}]});
 const r=await f.request();assert.deepEqual(r.data.items.map(x=>x.id),['AAAAAAAAAAA','BBBBBBBBBBB']);assert.equal(r.data.items[0].title,'<script>literal</script>');
});
test('stateless pagination stops at three pages without retry loops',async()=>{
 const f=await fixture({continuation:true});assert.equal((await f.request({query:'song',pageToken:'3'})).data.nextPageToken,'');assert.equal(f.stats().pages,2);
 const g=await fixture();assert.deepEqual((await g.request({query:'song',pageToken:'2'})).data,{items:[],nextPageToken:''});assert.equal(g.stats().pages,0);
});
test('library fetch cannot contact third parties or follow redirects',async()=>{
 const f=await fixture();await f.request();await assert.rejects(()=>f.options().fetch('https://evil.test'),/SEARCH_TARGET_DENIED/);
 await f.options().fetch('https://www.youtube.com/youtubei/v1/search',{method:'POST'});
 const call=f.calls.at(-1);assert.equal(call.opts.redirect,'error');assert.equal(call.opts.headers,undefined);
});
