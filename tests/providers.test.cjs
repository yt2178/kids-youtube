const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createManager,fetchJSON,httpError,AppError}=require('../providers.js');
const bases=['https://one.example','https://two.example','https://three.example'];
const scope='https://parent.github.io/kids-youtube/';
const ok=data=>({ok:true,status:200,json:async()=>data});
function manager(fetcher,extra={}) {const data=new Map();return createManager({instances:bases,scope,fetcher,storage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)},...extra});}
for(const [status,code] of [[401,'UNAUTHORIZED'],[403,'FORBIDDEN'],[404,'NOT_FOUND'],[429,'RATE_LIMITED'],[500,'PROVIDER_ERROR']]) {
  test('HTTP '+status+' moves to next provider without an infinite retry',async()=>{
    const calls=[];const p=manager(async url=>{calls.push(url);return url.startsWith(bases[0])?{ok:false,status}:ok({id:'expected'});});
    assert.deepEqual(await p.request('/api/v1/videos/example'),{id:'expected'});assert.equal(calls.length,2);
    assert.equal(p.snapshot().requests[0].outcome,code);
    if([401,403,429].includes(status))assert.equal(p.getHealthyProviders().includes(bases[0]),false);
  });
}
test('browser network/CORS TypeError moves on and is not misclassified as a proven CORS error',async()=>{
  const p=manager(async url=>{if(url.startsWith(bases[0]))throw new TypeError('Failed to fetch');return ok({ready:true});});
  assert.deepEqual(await p.request('/api/v1/stats'),{ready:true});assert.equal(p.snapshot().requests[0].outcome,'NETWORK_OR_CORS');
});
test('timeout includes a hung response body and aborts the request',async()=>{
  let signal;
  await assert.rejects(fetchJSON(async (url,opts)=>{signal=opts.signal;return {ok:true,json:()=>new Promise(()=>{})};},'https://one.example',{timeout:5}),e=>e.code==='TIMEOUT');
  assert.equal(signal.aborted,true);
});
test('fallback is finite even when every provider rejects',async()=>{
  let calls=0;const p=manager(async()=>{calls++;return {ok:false,status:500};});
  await assert.rejects(p.request('/api/v1/videos/missing'),e=>e.code==='PROVIDER_ERROR');assert.equal(calls,3);
  await assert.rejects(p.request('/api/v1/videos/missing'));assert.equal(calls,3);
});
test('caller cancellation stops fallback and does not poison provider health',async()=>{
  const controller=new AbortController();let calls=0;
  const p=manager(async(url,opts)=>{calls++;return new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(Object.assign(new Error(),{name:'AbortError'}))));});
  const request=p.request('/api/v1/videos/slow',{signal:controller.signal});controller.abort();
  await assert.rejects(request,e=>e.code==='CANCELLED');assert.equal(calls,1);assert.equal(p.getHealthyProviders().length,3);
});
test('cooldown suppresses repeated requests until it expires',async()=>{
  let now=100000,calls=0;const p=manager(async()=>{calls++;return {ok:false,status:403};},{clock:()=>now});
  await assert.rejects(p.request('/api/v1/first'));assert.equal(calls,3);
  await assert.rejects(p.request('/api/v1/other'));assert.equal(calls,3);
  now+=31000;assert.equal(p.getHealthyProviders().length,3);await assert.rejects(p.request('/api/v1/other'));assert.equal(calls,6);
});
test('API failure leaves independent playback capability eligible',async()=>{
  const p=manager(async()=>({ok:false,status:401}));await assert.rejects(p.request('/api/v1/stats'));
  assert.equal(p.getHealthyProviders('api').length,0);assert.equal(p.getHealthyProviders('playback').length,3);
});
test('cache TTL, validation, and clearing work without permanent stale data',async()=>{
  let now=10000,calls=0;const p=manager(async()=>ok({value:++calls}),{clock:()=>now});
  const options={ttl:100,validate:d=>typeof d.value==='number'};
  assert.equal((await p.request('/api/v1/test',options)).value,1);assert.equal((await p.request('/api/v1/test',options)).value,1);assert.equal(calls,1);
  now+=101;assert.equal((await p.request('/api/v1/test',options)).value,2);p.clearCache();assert.equal((await p.request('/api/v1/test',options)).value,3);
});
test('simultaneous identical metadata reads coalesce into one request',async()=>{
  let release,calls=0;const p=manager(async()=>{calls++;await new Promise(r=>release=r);return ok({title:'x'});});
  const a=p.request('/api/v1/videos/example'),b=p.request('/api/v1/videos/example');release();await Promise.all([a,b]);assert.equal(calls,1);assert.equal(p.snapshot().inflight,0);
});
test('corrupt persistent cache cannot pass endpoint validation',async()=>{
  const storage={getItem:k=>JSON.stringify({entries:[{key:'/api/v1/videos/id',data:{videoId:'wrong'},expires:Date.now()+1000}]}),setItem(){}};
  let calls=0;const p=manager(async()=>{calls++;return ok({videoId:'right'});},{storage});
  assert.equal((await p.request('/api/v1/videos/id',{validate:d=>d.videoId==='right'})).videoId,'right');assert.equal(calls,1);
});
test('not-found is resource-specific and does not disable another video',async()=>{
  const p=manager(async()=>({ok:false,status:404}));await assert.rejects(p.request('/api/v1/videos/missing'));assert.equal(p.getHealthyProviders().length,3);
});
test('invalid response fails over without marking unrelated content unavailable',async()=>{
  const p=manager(async url=>ok({videoId:url.startsWith(bases[0])?'wrong':'right'}));
  assert.equal((await p.request('/api/v1/videos/id',{validate:d=>d.videoId==='right'})).videoId,'right');assert.equal(p.getHealthyProviders().length,3);
});
test('health check probes one provider, not every server, and never proves playback',async()=>{
  let calls=0;const p=manager(async()=>{calls++;return ok({software:{name:'invidious'}});});await p.healthCheck();assert.equal(calls,1);
  assert.equal(p.snapshot().health[bases[0]].api.status,'healthy');assert.equal(p.snapshot().health[bases[0]].playback.status,'unknown');
});
test('data from local cache is never marked as fresh network authorization evidence',async()=>{
  const p=manager(async()=>ok({videos:[]}));const first=await p.request('/api/v1/test',{ttl:1000});assert.equal(p.isNetworkData(first),true);
  const storage={getItem:()=>JSON.stringify({entries:[{key:'/api/v1/test',data:{videos:[]},expires:Date.now()+1000}]}),setItem(){}};
  const q=manager(async()=>{throw new Error('offline');},{storage});assert.equal(q.isNetworkData(await q.request('/api/v1/test')),false);
});
test('cache storage failures do not interrupt requests or playback health',async()=>{
  const p=manager(async()=>ok({valid:true}),{storage:{getItem(){throw new Error('blocked');},setItem(){throw new Error('full');}}});
  assert.equal((await p.request('/api/v1/test',{ttl:1000})).valid,true);p.updateProviderHealth(bases[0],'playback',true,10);assert.equal(p.getHealthyProviders('playback')[0],bases[0]);
});
