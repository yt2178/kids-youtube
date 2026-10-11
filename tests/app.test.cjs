// Development tests only. Run: node --test tests/app.test.cjs
// No packages, install command, or build step required.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
scripts.push(fs.readFileSync(path.join(root,'app.js'),'utf8'));
const providerScript=fs.readFileSync(path.join(root,'providers.js'),'utf8');
const A = 'UC' + 'A'.repeat(22), B = 'UC' + 'B'.repeat(22);
const id = n => 'vid' + String(n).padStart(8,'0');
const row = (n,channel=A) => ({videoId:id(n),title:'סרטון '+n,authorId:channel});
const empty = {videos:[],channels:[]};
const json = (data,{status=200,headers={}}={}) => ({ok:status>=200&&status<300,status,headers:{get:key=>headers[String(key).toLowerCase()]??headers[key]??null},json:async()=>data,text:async()=>typeof data === 'string' ? data : JSON.stringify(data)});
const fail = () => { throw new Error('Unavailable'); };
async function until(check) {
  for(let i=0;i<200;i++) { if(check()) return; await new Promise(r=>setTimeout(r,2)); }
  throw new Error('Test condition did not complete');
}
class Element {
  constructor(tag='div',fragment=false) { this.tagName=tag;this.fragment=fragment;this.hidden=false;this.children=[];this.attributes={};this.dataset={};this.style={};this.listeners={};this.isConnected=true;this.sentMessages=[];this.contentWindow={postMessage:(message,origin)=>this.sentMessages.push({message,origin})}; }
  append(...nodes) { this.children.push(...nodes.flatMap(n=>n.fragment?n.children:[n]));for(const n of nodes)if(n.tagName==='iframe' && !n.src)for(const fn of n.listeners.load || [])fn(); }
  replaceChildren(...nodes) { this.children=[];this.append(...nodes); }
  setAttribute(k,v) { this.attributes[k]=String(v); }
  removeAttribute(k) { delete this.attributes[k]; if(k==='src')this.src=''; }
  pause() {this.paused=true;}
  load() {}
  play() {this.paused=false;return Promise.resolve();}
  closest() {return null;}
  getAttribute(k) { return this.attributes[k]??null; }
  addEventListener(k,fn) { (this.listeners[k]??=[]).push(fn); }
  blur() { this.doc.activeElement=null; }
  focus() { this.doc.activeElement=this; }
  contains(el) { return this.children.includes(el); }
  querySelectorAll() { return this.children; }
}
async function app(config=empty,api=()=>json({videos:[],continuation:null}),store=new Map(),options={}) {
  const elements={};const calls=[];
  const docListeners={};
  const document={head:new Element('head'),body:new Element('body'),activeElement:null,hidden:false,addEventListener:(k,fn)=>(docListeners[k]??=[]).push(fn),removeEventListener:(k,fn)=>docListeners[k]=(docListeners[k]||[]).filter(f=>f!==fn),
    getElementById:id=>elements[id],createElement:tag=>{const el=new Element(tag);el.doc=document;return el;},
    createDocumentFragment:()=>new Element('fragment',true)};
  for(const m of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const el=new Element(m[1]);el.doc=document;el.hidden=/\bhidden\b/.test(m[2]);
    for(const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g))el.attributes[a[1]]=a[2];
    elements[m[3]]=el;
  }
  const listeners={};
  const history={state:null,pushState(state){this.state=state;},replaceState(state){this.state=state;},back(){this.state=null;}};
  const context=vm.createContext({URL,AbortController,Response,setTimeout:options.clock ? options.clock.setTimeout : options.timerCap ? ((fn,ms)=>setTimeout(fn,Math.min(ms,options.timerCap))) : setTimeout,clearTimeout:options.clock ? options.clock.clearTimeout : clearTimeout,Date,Map,Set,Promise,console:options.logCollector?{log:(...args)=>options.logCollector.push(args.map(String).join(' '))}:console,history,
    navigator:{},scrollY:0,scrollTo(position){this.scrollY=position.top;},location:{href:options.href||'https://example.test/kids-youtube/',origin:new URL(options.href||'https://example.test/kids-youtube/').origin},document,
    localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>{if(options.noStorage)throw new Error('quota');store.set(k,v);}},
    fetch:async(url,opts)=>{calls.push({url:String(url),opts});const target=String(url);const raw=typeof config==='string'?config:JSON.stringify(config);if(target.includes('/functions/v1/kids-youtube?action=list'))return options.listFetch?options.listFetch({url:target,opts,calls,raw}):options.offline?fail():json({list:raw,...(options.sharedCatalog?{catalogVersion:1,version:options.grantVersion??options.sharedCatalog.version??7,updatedAt:options.sharedCatalog.updatedAt??'stable'}:{})});if(target.includes('/functions/v1/kids-youtube?action=catalog'))return options.catalogFetch?options.catalogFetch({url:target,opts,calls}):json(options.sharedCatalog);if(target==='./videos.txt')return options.offline?fail():json(config);return api(target,opts);},
    addEventListener:(k,fn)=>(listeners[k]??=[]).push(fn),removeEventListener:(k,fn)=>listeners[k]=(listeners[k]||[]).filter(f=>f!==fn)});
  context.window=context;
  if(options.nativeMode){
    // Native Android returns the catalog with the authoritative whitelist;
    // the browser-only catalogFetch fixture is never used for this path.
    const nativeGrant=options.nativeFetchAuthorization||
      (!options.listFetch&&options.sharedCatalog?async()=>({
        list:typeof config==='string'?config:JSON.stringify(config),
        version:options.sharedCatalog.version,updatedAt:options.sharedCatalog.updatedAt,
        catalogVersion:1,preparedCatalog:options.sharedCatalog
      }):undefined);
    context.KidsNative={...(nativeGrant?{fetchAuthorization:nativeGrant}:{}),
      ...(options.nativeFetchCatalog?{fetchCatalog:options.nativeFetchCatalog}:{})};
  }
  if(options.parentWindow){
    const here=new URL(options.href||'https://example.test/kids-youtube/');
    context.parent={location:{origin:here.origin,pathname:new URL('./parents.html',here).pathname},...options.parentWindow};
  }else context.parent=context;
  if(options.storageAccessDenied)Object.defineProperty(context,'localStorage',{get(){throw new Error('SecurityError: storage access denied');}});
  vm.runInContext(scripts[0],context,{filename:'service-worker-registration.js'});
  vm.runInContext(providerScript,context,{filename:'providers.js'});
  vm.runInContext(scripts[1],context,{filename:'index-inline.js'});
  await until(()=>!vm.runInContext('loading',context));
  return {context,elements,calls,store,document,listeners,docListeners,run:code=>vm.runInContext(code,context)};
}
const plain = obj => JSON.parse(JSON.stringify(obj));

test('public child CSP is exact and permits only required application origins',()=>{
  const policy=(html.match(/<meta id="app-csp" http-equiv="Content-Security-Policy" content="([^"]+)">/)||[])[1];
  assert.ok(policy);assert.match(policy,/default-src 'self'/);assert.match(policy,/media-src 'none'/);assert.match(policy,/frame-src 'none'/);
  assert.match(policy,/connect-src 'self' https:\/\/jxhelpxhrmwvzrrfrjuh\.supabase\.co https:\/\/invidious\.f5\.si https:\/\/invidious\.tiekoetter\.com https:\/\/yt\.chocolatemoo53\.com/);
  assert.doesNotMatch(policy,/https:\/\/\*|\s\*\s|unsafe-eval|fonts\.gstatic/);
});

test('local JS and service worker parse, no third-party scripts/frameworks',()=>{
  scripts.forEach(s=>new vm.Script(s));new vm.Script(fs.readFileSync(path.join(root,'sw.js'),'utf8'));
  assert.equal(scripts.length,2);const external=[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>m[1]);assert.equal(external.length,2);assert.match(external[0],/^\.\/providers\.js\?v=\d+[a-z]$/);assert.match(external[1],/^\.\/app\.js\?v=\d+[a-z]$/);new vm.Script(providerScript);
  assert.match(html,/<html lang="he" dir="rtl">/);assert.match(html,/href="\.\/manifest.json"/);
  assert.doesNotMatch(html,/\/kids-youtube\/sw\.js/);
});
test('sample placeholders do not approve actual content',async()=>{
  const a=await app(fs.readFileSync(path.join(__dirname,'fixtures','example-list.txt'),'utf8'));
  assert.equal(a.run('displayed.size'),0);assert.equal(a.calls.length,1);assert.equal(a.elements.empty.hidden,false);
});
test('manual whitelist, invalid IDs, duplicate IDs and literal titles',async()=>{
  const a=await app({videos:[{id:id(1),title:'<script>alert(1)</script>'},{id:id(1),title:'duplicate'},{id:'bad',title:'bad'}],channels:[]});
  assert.equal(a.run('displayed.size'),1);assert.equal(a.elements.grid.children[0].children[1].textContent,'<script>alert(1)</script>');
  assert.equal(a.calls[0].opts.cache,'no-store');
});
test('object API response, continuation encoding and manual/channel deduplication',async()=>{
  const a=await app({videos:[{id:id(1),title:'הכותרת של ההורה'}],channels:[{id:A,name:'ערוץ'}]},url=>json(new URL(url).searchParams.has('continuation')?{videos:[row(2),row(3)],continuation:null}:{videos:[row(1),row(2)],continuation:'next+/?=&'}));
  assert.equal(a.run('displayed.size'),2);await a.run('loadMoreVideos()');
  assert.equal(a.run('displayed.size'),3);assert.equal(a.run(`displayed.get('${id(1)}').title`),'הכותרת של ההורה');
  assert.equal(new URL(a.calls[2].url).searchParams.get('continuation'),'next+/?=&');
});
test('maxVideos strictly limits output and stops additional page requests',async()=>{
  const a=await app({videos:[],channels:[{id:A,name:'A',maxVideos:2}]},()=>json({videos:[row(1),row(2),row(3)],continuation:'more'}));
  assert.equal(a.run('displayed.size'),2);assert.equal(a.calls.length,2);
});
test('repeated pagination token stops an infinite loop',async()=>{
  const a=await app({videos:[],channels:[{id:A}]},()=>json({videos:[row(1)],continuation:'same'}));
  await a.run('loadMoreVideos()');assert.equal(a.calls.length,3);assert.equal(a.run('displayed.size'),1);
});
test('safety limit stops after 100 pages',async()=>{
  let page=0;
  const a=await app({videos:[],channels:[{id:A}]},()=>json({videos:[row(++page)],continuation:String(page)}));
  for(let i=0;i<110;i++)await a.run('loadMoreVideos()');
  assert.equal(page,100);assert.equal(a.run('displayed.size'),100);
});
test('channel instance fallback and last-working instance are persisted',async()=>{
  const a=await app({videos:[],channels:[{id:A}]},url=>url.includes('invidious.f5')?fail():json({videos:[row(1)],continuation:null}));
  assert.equal(a.calls.length,3);assert.match(JSON.parse(a.store.get('kidsYoutubeLastInstance')).url,/tiekoetter/);
  assert.match(a.calls[2].url,/tiekoetter/);
});
test('a failed channel does not prevent a different channel from loading',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[{id:A},{id:B}]},url=>url.includes(A)?fail():json({videos:[row(2,B)],continuation:null}));
  assert.equal(a.run('displayed.size'),2);assert.ok(a.calls.some(c=>c.url.includes(B)));
});
test('API rejects author mismatch and malformed direct-array responses',async()=>{
  const a=await app({videos:[],channels:[{id:A}]},()=>json({videos:[row(1,B),row(2)],continuation:null}));
  assert.deepEqual(plain(a.run('[...displayed.keys()]')),[id(2)]);
  const b=await app({videos:[{id:id(3)}],channels:[{id:A}]},()=>json([row(4)]));
  assert.equal(b.run('displayed.size'),1);
});
test('partial pages remain visible when later pages fail',async()=>{
  const a=await app({videos:[],channels:[{id:A}]},url=>new URL(url).searchParams.has('continuation')?fail():json({videos:[row(1)],continuation:'next'}));
  assert.equal(a.run('displayed.size'),1);assert.ok(JSON.parse(a.store.get('kidsYoutubeVideos')).channelLists[A].length);
});
test('all instances failing preserve the previous approved channel list',async()=>{
  const config={videos:[{id:id(1)}],channels:[{id:A}]};const store=new Map();
  await app(config,()=>json({videos:[row(2)],continuation:null}),store);
  for(const key of [...store.keys()])if(key.startsWith('kidsYoutubeData:'))store.delete(key);
  const a=await app(config,fail,store);
  // Warm startup can avoid contacting the unavailable provider altogether.
  assert.equal(a.run('displayed.size'),2);
  await a.run('loadApp({forceCatalog:true})');
  assert.equal(a.run('displayed.size'),2);assert.match(a.elements['status-text'].textContent,/התוכן שכבר נטען עדיין מוצג/);
});
test('offline whitelist fails closed instead of showing stale approvals',async()=>{
  const store=new Map();await app({videos:[{id:id(1)}],channels:[]},undefined,store);
  const a=await app(empty,fail,store,{offline:true});
  assert.equal(a.run('displayed.size'),0);assert.equal(a.elements.empty.hidden,false);
  assert.match(a.elements['empty-title'].textContent,/לא הצלחנו לטעון/);
});
test('empty offline fallback shows a friendly retry state',async()=>{
  const a=await app(empty,fail,new Map(),{offline:true});
  assert.equal(a.run('displayed.size'),0);assert.equal(a.elements.empty.hidden,false);
  assert.match(a.elements['empty-title'].textContent,/לא הצלחנו לטעון/);
  assert.equal(a.elements['empty-clear'].dataset.action,'retry');assert.equal(a.elements['empty-clear'].textContent,'נסו שוב');
  assert.equal(a.elements.spinner.hidden,true);
});
test('fresh removal of manual video/channel also prunes persistent cache',async()=>{
  const store=new Map();await app({videos:[{id:id(1)}],channels:[{id:A}]},()=>json({videos:[row(2)],continuation:null}),store);
  const a=await app(empty,fail,store);
  assert.equal(a.run('displayed.size'),0);assert.deepEqual(Object.keys(JSON.parse(store.get('kidsYoutubeVideos')).channelLists),[]);
  const offline=await app(empty,fail,store,{offline:true});assert.equal(offline.run('displayed.size'),0);
});
test('new maxVideos also caps older cached data during an outage',async()=>{
  const store=new Map();await app({videos:[],channels:[{id:A}]},()=>json({videos:[row(1),row(2),row(3)],continuation:null}),store);
  const a=await app({videos:[],channels:[{id:A,maxVideos:1}]},fail,store);assert.equal(a.run('displayed.size'),1);
});
test('successful empty channel response removes obsolete cached videos',async()=>{
  const store=new Map();await app({videos:[],channels:[{id:A}]},()=>json({videos:[row(1)],continuation:null}),store);
  for(const key of [...store.keys()])if(key.startsWith('kidsYoutubeData:'))store.delete(key);
  const a=await app({videos:[],channels:[{id:A}]},()=>json({videos:[],continuation:null}),store);
  assert.equal(a.run('displayed.size'),1,'warm list remains while channel cache is fresh');
  await a.run('loadApp({forceCatalog:true})');
  assert.equal(a.run('displayed.size'),0,'fresh empty page removes obsolete video');

});
test('invalid current whitelist fails closed rather than reviving old cache',async()=>{
  const store=new Map();await app({videos:[{id:id(1)}],channels:[]},undefined,store);
  const a=await app({videos:'invalid',channels:[]},undefined,store);assert.equal(a.run('displayed.size'),0);
  assert.equal(JSON.parse(store.get('kidsYoutubeVideos')).config.videos.length,0);
});
test('cache is isolated across GitHub Pages repository paths',async()=>{
  const store=new Map();await app({videos:[{id:id(1)}],channels:[]},undefined,store);
  const a=await app(empty,fail,store,{offline:true,href:'https://example.test/other-repo/'});assert.equal(a.run('displayed.size'),0);
});
test('disabled localStorage still allows approved cards and more cards',async()=>{
  const a=await app({videos:Array.from({length:61},(_,n)=>({id:id(n)})),channels:[]},undefined,new Map(),{noStorage:true});
  assert.equal(a.elements.grid.children.length,60);
  a.elements.more.listeners.click[0]();assert.equal(a.elements.grid.children.length,61);
});
test('channel fetching is parallel with a concurrency ceiling of three',async()=>{
  let active=0,peak=0;
  const a=await app({videos:[],channels:Array.from({length:5},(_,n)=>({id:'UC'+String(n).repeat(22)}))},async()=>{
    active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;return json({videos:[],continuation:null});
  });
  assert.equal(peak,3);assert.equal(a.calls.length,6);
});
test('more cards never revive revoked approvals when cache writes fail',async()=>{
  const store=new Map();
  await app({videos:[{id:id(99)}],channels:[]},undefined,store);
  const a=await app({videos:Array.from({length:61},(_,n)=>({id:id(n)})),channels:[]},undefined,store,{noStorage:true});
  a.elements.more.listeners.click[0]();
  assert.equal(a.elements.grid.children.length,61);
  assert.equal(a.run(`displayed.has('${id(99)}')`),false);
});
test('website video tap shows an app-only prompt and never creates browser media',async()=>{
  const a=await app({videos:[{id:id(1),title:'סרטון שלנו'}],channels:[]},undefined,new Map(),{timerCap:5});
  a.run(`openPlayer('${id(1)}')`);
  assert.equal(a.elements.player.hidden,false);
  assert.equal(a.elements['media-host'].children.length,0);
  assert.match(a.elements['app-open-message'].textContent,/אפשר לפתוח באפליקציית Kids YouTube/);
  a.elements['retry-video'].listeners.click[0]();
  assert.equal(a.context.location.href,'kidsyoutube://video/'+id(1));
  await new Promise(r=>setTimeout(r,12));
  assert.match(a.elements['app-open-message'].textContent,/עדיין לא מותקנת/);
  a.run('closePlayer(true)');assert.equal(a.elements.player.hidden,true);
});
test('browser playback transport remains disabled even if its old helper is called',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]});
  a.run(`openPlayer('${id(1)}'); tryPlayer()`);
  await new Promise(r=>setTimeout(r,0));
  assert.equal(a.elements['media-host'].children.length,0);
});
test('request timeout aborts stalled fetches',async()=>{
  const a=await app();a.context.fetch=(url,opts)=>new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new Error('timeout'))));
  await assert.rejects(a.run("fetchJson('https://example.test/stall', 5)"));
});
test('manifest and icon dimensions are valid at multiple subdirectory names',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  assert.equal(manifest.display,'standalone');assert.equal(manifest.dir,'rtl');
  for(const base of ['https://owner.github.io/kids-youtube/','https://owner.github.io/renamed/']){
    assert.equal(new URL(manifest.start_url,base).href,base);assert.equal(new URL(manifest.scope,base).href,base);
    for(const icon of manifest.icons){
      assert.equal(new URL(icon.src,base).href.startsWith(base),true);
      const png=fs.readFileSync(path.join(root,icon.src));const [w,h]=icon.sizes.split('x').map(Number);
      assert.equal(png.readUInt32BE(16),w);assert.equal(png.readUInt32BE(20),h);
    }
  }
});
test('service worker registration uses ./sw.js',()=>{
  let registration;
  vm.runInNewContext(scripts[0],{navigator:{serviceWorker:{register:p=>{registration=p;return Promise.resolve();}}}});
  assert.equal(registration,'./sw.js');
});
test('service worker installs shell, activates, excludes whitelist and cross-origin traffic',async()=>{
  const handlers={},cached=new Map(),deleted=[];let skip=0,claim=0;
  const cache={addAll:async reqs=>reqs.forEach(r=>cached.set(r.url,json({}))),put:async(k,v)=>cached.set(k,v)};
  const scope='https://owner.github.io/renamed/';
  const context=vm.createContext({URL,Request,console,
    self:{registration:{scope},skipWaiting:async()=>skip++,clients:{claim:async()=>claim++},addEventListener:(k,fn)=>handlers[k]=fn},
    caches:{open:async()=>cache,keys:async()=>['kids-youtube-shell:'+scope+':old','some-other-app'],delete:async k=>deleted.push(k),match:async k=>cached.get(k)},
    fetch:async()=>{throw new Error('offline');}});
  vm.runInContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),context);
  let work;handlers.install({waitUntil:p=>work=p});await work;assert.equal(skip,1);assert.equal(cached.size,6);
  handlers.activate({waitUntil:p=>work=p});await work;assert.equal(claim,1);assert.equal(deleted.length,1);assert.match(deleted[0],/old$/);
  assert.equal([...cached.keys()].some(url=>/player\.html|player\.js/.test(url)),false);
  for(const url of [scope+'videos.txt','https://invidious.example/api/v1/videos/abc']){
    let intercepted=false;handlers.fetch({request:{url,method:'GET',mode:'cors'},respondWith:()=>intercepted=true});assert.equal(intercepted,false);
  }
  let response;handlers.fetch({request:{url:scope,method:'GET',mode:'navigate'},respondWith:p=>response=p});assert.ok(await response);
});
test('responsive child UI has compact search/sort controls and no refresh button',()=>{
  assert.match(html,/minmax\(min\(100%,230px\),1fr\)/);assert.match(html,/data-view="list"/);
  assert.match(html,/id="search-toggle"/);assert.match(html,/id="search-row" hidden/);
  assert.match(html,/summary aria-label="סינון וסידור"/);assert.doesNotMatch(html,/id="refresh"/);
  assert.match(html,/id="pull-refresh"/);assert.match(html,/prefers-reduced-motion:reduce/);
  assert.match(html,/@media \(max-width:360px\)/);assert.match(html,/@media \(max-height:520px\)/);
});

test('view choice switches between grid and list and persists on the device',async()=>{
  const store=new Map(),config={videos:[{id:id(1),title:'שיר'}],channels:[]};
  const a=await app(config,undefined,store);assert.equal(a.elements.grid.dataset.view,'grid');
  a.elements['view-list'].listeners.click[0]();assert.equal(a.elements.grid.dataset.view,'list');
  assert.equal(a.elements['view-list'].getAttribute('aria-pressed'),'true');
  assert.equal(JSON.parse(store.get('kidsYoutubeViewMode')),'list');
  const b=await app(config,undefined,store);assert.equal(b.elements.grid.dataset.view,'list');
  b.elements['view-grid'].listeners.click[0]();assert.equal(b.elements.grid.dataset.view,'grid');
});
test('fast successful loading does not leave a spinner on screen',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]});
  assert.equal(a.elements.spinner.hidden,true);assert.equal(a.elements.status.hidden,true);
});
test('successful empty list is distinct from network failure',async()=>{
  const a=await app(empty);assert.equal(a.elements.empty.hidden,false);
  assert.match(a.elements['empty-title'].textContent,/עדיין אין כאן סרטונים/);
  assert.equal(a.elements['empty-clear'].hidden,true);assert.equal(a.run('loadError'),false);
});

const link = n => 'https://youtu.be/' + id(n);
const channelLink = channel => 'https://www.youtube.com/channel/' + channel;
function metadataApi(url) {
  const parsed=new URL(url),p=parsed.pathname;
  if(p==='/api/v1/resolveurl')return json({ucid:A,pageType:'CHANNEL'});
  if(p.endsWith('/videos') && p.includes('/channels/'))return json({videos:[{...row(1),author:'שם ערוץ מהשרת'},row(2)],continuation:null});
  if(p.includes('/api/v1/channels/'))return json({authorId:p.split('/').pop(),author:'שם הערוץ האוטומטי'});
  if(p.includes('/api/v1/videos/'))return json({videoId:p.split('/').pop(),title:'שם הסרטון האוטומטי',author:'יוצר הסרטון'});
  return fail();
}
test('plain list ignores // comments, blank lines and BOM/CRLF without breaking https://',async()=>{
  const a=await app('\uFEFF// הערה\r\n\r\n'+link(1)+' // השיר שלנו\r\n  // עוד הערה\r\n'+channelLink(A),metadataApi);
  assert.equal(a.run('activeConfig.videos.length'),1);assert.equal(a.run('activeConfig.channels.length'),1);
  assert.equal(a.run('displayed.size'),2);assert.match(a.calls[0].url,/\/functions\/v1\/kids-youtube\?action=list$/);assert.equal(a.calls[0].opts.cache,'no-store');
  assert.equal(a.run(`displayed.get('${id(1)}').title`),'שם הסרטון האוטומטי');
  const videoCard=[...a.elements.grid.children].find(card=>card.dataset.videoId===id(1));assert.equal(videoCard.children[2].textContent,'יוצר הסרטון');
  assert.equal(a.run('activeConfig.channels[0].name'),'שם הערוץ האוטומטי');
});
test('video share, watch, Shorts, live, embed and music URLs canonicalize and deduplicate',async()=>{
  const urls=[link(1)+'?si=test',`https://www.youtube.com/watch?v=${id(1)}&t=5`,`https://m.youtube.com/shorts/${id(1)}`,`https://youtube.com/live/${id(1)}`,`https://www.youtube.com/embed/${id(1)}`,`music.youtube.com/watch?v=${id(1)}`];
  const a=await app(urls.join('\n'),metadataApi);
  assert.equal(a.run('displayed.size'),1);assert.equal(a.calls.length,2);
  assert.equal(Object.keys(JSON.parse(a.store.get('kidsYoutubeVideos')).linkRecords).length,1);
});
test('channel UC, handle, legacy custom and user URLs automatically resolve channel IDs',async()=>{
  for(const url of [channelLink(A)+'/videos?view=0','https://youtube.com/@Example/shorts?si=x','https://www.youtube.com/c/Example/featured','https://m.youtube.com/user/Example/about','https://www.youtube.com/@%D7%93%D7%95%D7%92%D7%9E%D7%94']) {
    const a=await app(url,metadataApi);
    assert.equal(a.run('activeConfig.channels[0].id'),A);assert.equal(a.run('displayed.size'),2);
    const resolve=a.calls.find(c=>c.url.includes('/resolveurl?'));
    if(!url.includes('/channel/')) {assert.ok(resolve);assert.match(new URL(resolve.url).searchParams.get('url'),/^https:\/\/www.youtube.com\//);}
    else assert.equal(resolve,undefined);
  }
});
test('invalid hosts, IDs, credentials, paths and unsupported playlists are ignored',async()=>{
  const urls=['https://evil.example/watch?v='+id(1),'https://youtube.com.evil.example/@Example','https://u:p@youtube.com/@Example','https://youtube.com/playlist?list=PLx','https://youtu.be/'+id(1)+'/extra','https://youtube.com/watch?v='+id(1)+'&v='+id(2),'https://youtube.com/@','https://youtube.com/@Example%2Fextra','https://youtube.com/@Example%5Cextra','javascript:alert(1)','https://youtube.com/@Example/unknown','https://youtube.com/watch?v=short'];
  const a=await app(urls.join('\n'),metadataApi);
  assert.equal(a.run('displayed.size'),0);assert.equal(a.calls.length,1);assert.match(a.elements['status-text'].textContent,/זקוקים לבדיקה/);
});
test('mixed valid and invalid links retain only valid approvals',async()=>{
  const a=await app('this is not a URL\n'+link(1)+' // תקין\nhttps://evil.example',metadataApi);
  assert.equal(a.run('displayed.size'),1);assert.equal(a.run('activeConfig.channels.length'),0);
});
test('metadata fallback retries another instance and saves its successful name',async()=>{
  const a=await app(link(1),url=>url.includes('invidious.f5')?fail():metadataApi(url));
  assert.equal(a.calls.length,3);assert.equal(a.run('activeConfig.videos[0].title'),'שם הסרטון האוטומטי');
  assert.match(a.store.get('kidsYoutubeLastInstance'),/tiekoetter/);
});
test('mismatched video metadata is rejected before accepting the next instance',async()=>{
  const a=await app(link(1),url=>url.includes('invidious.f5')?json({videoId:id(2),title:'wrong'}):metadataApi(url));
  assert.equal(a.calls.length,3);assert.equal(a.run('activeConfig.videos[0].title'),'שם הסרטון האוטומטי');
});
test('failed channel resolution does not remove direct approved videos',async()=>{
  const a=await app(link(1)+'\nhttps://youtube.com/@Unreachable',url=>url.includes('/api/v1/videos/')?metadataApi(url):fail());
  assert.equal(a.run('displayed.size'),1);assert.equal(a.run('activeConfig.channels.length'),0);
});
test('resolveurl may use browseId and must return a real channel ID',async()=>{
  const a=await app('https://youtube.com/@Example',url=>url.includes('/resolveurl?')?json({browseId:A}):metadataApi(url));
  assert.equal(a.run('activeConfig.channels[0].id'),A);
  const b=await app('https://youtube.com/@Example',()=>json({videoId:id(1),browseId:id(1)}));
  assert.equal(b.run('displayed.size'),0);assert.equal(b.calls.length,4);
});
test('cached direct video metadata may survive, but channel aliases must resolve freshly before display',async()=>{
  const store=new Map(),list=link(1)+'\nhttps://youtube.com/@Example';
  await app(list,metadataApi,store);
  const a=await app(list,fail,store);
  assert.equal(a.run('displayed.size'),1);assert.equal(a.run('activeConfig.channels.length'),0);
  assert.equal(a.run('activeConfig.videos[0].title'),'שם הסרטון האוטומטי');
});
test('removed alias and manual link never reappear from cache during outages',async()=>{
  const store=new Map();await app(link(1)+'\nhttps://youtube.com/@Example',metadataApi,store);
  const a=await app('// הוסרו\n'+link(3),fail,store);
  assert.equal(a.run('displayed.size'),1);assert.equal(a.run('activeConfig.channels.length'),0);
  const saved=JSON.parse(store.get('kidsYoutubeVideos'));
  assert.deepEqual(Object.keys(saved.channelLists),[]);assert.deepEqual(Object.keys(saved.linkRecords),['https://www.youtube.com/watch?v='+id(3)]);
  const b=await app('',fail,store,{offline:true});assert.equal(b.run('displayed.size'),0);
});
test('comments-only list intentionally clears every approval and cached source',async()=>{
  const store=new Map();await app(link(1)+'\nhttps://youtube.com/@Example',metadataApi,store);
  const a=await app('// אין כרגע אישורים\n\n',fail,store);
  assert.equal(a.run('displayed.size'),0);assert.equal(a.calls.length,1);
  assert.deepEqual(JSON.parse(store.get('kidsYoutubeVideos')).linkRecords,{});
});
test('alias resolving to a different channel prunes old channel cached videos',async()=>{
  const store=new Map(),list='https://youtube.com/@Example';await app(list,metadataApi,store);
  for(const key of [...store.keys()])if(key.startsWith('kidsYoutubeData:'))store.delete(key);
  const a=await app(list,url=>url.includes('/resolveurl?')?json({ucid:B}):url.endsWith('/'+B)?json({authorId:B,author:'ערוץ חדש'}):fail(),store);
  assert.equal(a.run('activeConfig.channels[0].id'),B);assert.equal(a.run('displayed.size'),0);
  assert.deepEqual(Object.keys(JSON.parse(store.get('kidsYoutubeVideos')).channelLists),[B]);
});
test('plain channel list paginates and deduplicates automatically with manual video precedence',async()=>{
  const a=await app(link(1)+'\n'+channelLink(A),url=>url.includes('/channels/')&&new URL(url).pathname.endsWith('/videos')?json(new URL(url).searchParams.has('continuation')?{videos:[row(2),row(3)],continuation:null}:{videos:[row(1),row(2)],continuation:'page2'}):metadataApi(url));
  assert.equal(a.run('displayed.size'),2);await a.run('loadMoreVideos()');
  assert.equal(a.run('displayed.size'),3);assert.equal(a.run(`displayed.get('${id(1)}').title`),'שם הסרטון האוטומטי');
  assert.ok(a.calls.some(c=>new URL(c.url,'https://example.test/').searchParams.get('continuation')==='page2'));
});
test('automatic names are inserted as text, including the channel author',async()=>{
  const a=await app(link(1),()=>json({videoId:id(1),title:'<script>x</script>',author:'<img onerror=x>'}));
  assert.equal(a.elements.grid.children[0].children[1].textContent,'<script>x</script>');
  assert.equal(a.elements.grid.children[0].children[2].textContent,'<img onerror=x>');
});
test('plain links remain usable with unavailable localStorage',async()=>{
  const a=await app(link(1),metadataApi,new Map(),{noStorage:true});
  assert.equal(a.run('displayed.size'),1);assert.match(a.elements['status-text'].textContent,/לא הצלחנו לשמור/);
});

const visibleVideoIds = a => a.elements.grid.children.map(card=>card.dataset.videoId);
async function inputSearch(a,query) {
  a.elements.search.value=query;
  a.elements.search.listeners.input[0]();
  await until(()=>a.run('searchTimer')===null);
}
function clickGrid(a,card) {
  a.elements.grid.listeners.click[0]({target:{closest:()=>card}});
}
test('default video tab combines manual approvals and approved channels',async()=>{
  const a=await app({videos:[{id:id(3),title:'ידני'}],channels:[{id:A,name:'מאיר'}]},metadataApi);
  assert.deepEqual(visibleVideoIds(a),[id(3),id(1),id(2)]);
  assert.equal(a.elements['all-tab'].getAttribute('aria-pressed'),'true');
  assert.equal(a.elements['channels-tab'].getAttribute('aria-pressed'),'false');
});
test('channel tab lists only whole-channel approvals, not creators of manual videos',async()=>{
  const a=await app({videos:[{id:id(3),title:'סרטון',author:'יוצר לא מאושר'}],channels:[{id:A,name:'מאיר'}]},metadataApi);
  a.elements['channels-tab'].listeners.click[0]();
  assert.deepEqual(a.elements.grid.children.map(card=>card.dataset.channelId),[A]);
  assert.equal(a.elements['channels-tab'].getAttribute('aria-pressed'),'true');
  assert.match(a.elements['search-label'].textContent,/ערוצ/);
});
test('live search matches titles, authors and approved channel names without network requests',async()=>{
  const a=await app({videos:[{id:id(3),title:'שִׁיר לשבת',author:'יוצר יחיד'}],channels:[{id:A,name:'מאיר'}]},metadataApi);
  const count=a.calls.length;
  await inputSearch(a,'שיר');assert.deepEqual(visibleVideoIds(a),[id(3)]);
  await inputSearch(a,'יוצר יחיד');assert.deepEqual(visibleVideoIds(a),[id(3)]);
  await inputSearch(a,'מאיר');assert.deepEqual(visibleVideoIds(a),[id(1),id(2)]);
  await inputSearch(a,'מאיר 2');assert.deepEqual(visibleVideoIds(a),[id(2)]);
  assert.equal(a.calls.length,count);
});
test('manual/channel duplicate remains searchable by its approved channel name',async()=>{
  const a=await app({videos:[{id:id(1),title:'כותרת ידנית'}],channels:[{id:A,name:'מאיר'}]},metadataApi);
  await inputSearch(a,'מאיר');assert.deepEqual(visibleVideoIds(a),[id(1),id(2)]);
  assert.equal(a.elements.grid.children[0].children[1].textContent,'כותרת ידנית');
});
test('channel card opens only its own videos, including deduplicated manual approvals',async()=>{
  const a=await app({videos:[{id:id(1),title:'ידני'},{id:id(3),title:'בחוץ'}],channels:[{id:A,name:'מאיר'},{id:B,name:'אחר'}]},url=>json({videos:[row(url.includes(B)?4:1,url.includes(B)?B:A)],continuation:null}));
  a.elements['channels-tab'].listeners.click[0]();clickGrid(a,a.elements.grid.children[0]);
  assert.deepEqual(visibleVideoIds(a),[id(1)]);assert.equal(a.elements['channel-heading'].hidden,false);
  assert.equal(a.elements['channel-name'].textContent,'מאיר');
  await inputSearch(a,'בחוץ');assert.equal(a.elements.grid.children.length,0);
  assert.equal(a.elements.player.hidden,true);
});
test('channel name search filters channel cards and clear button restores all',async()=>{
  const a=await app({videos:[],channels:[{id:A,name:'מאיר'},{id:B,name:'סיפורים'}]},()=>json({videos:[],continuation:null}));
  a.elements['channels-tab'].listeners.click[0]();await inputSearch(a,'סיפורים');
  assert.deepEqual(a.elements.grid.children.map(card=>card.dataset.channelId),[B]);
  a.elements['clear-search'].listeners.click[0]();assert.equal(a.elements.grid.children.length,2);
  assert.equal(a.elements.search.value,'');assert.equal(a.elements['clear-search'].hidden,true);
});
test('no matches shows a friendly reset and keeps the approved authorization map',async()=>{
  const a=await app({videos:[{id:id(1),title:'מאושר'}],channels:[]});
  await inputSearch(a,'לא קיים');assert.equal(a.elements.empty.hidden,false);assert.match(a.elements['empty-title'].textContent,/לא מצאתי/);
  assert.equal(a.elements['empty-clear'].hidden,false);assert.equal(a.elements.more.hidden,true);assert.equal(a.run('displayed.size'),1);
  a.elements['empty-clear'].listeners.click[0]();assert.deepEqual(visibleVideoIds(a),[id(1)]);assert.equal(a.elements.empty.hidden,true);
});
test('more cards apply the current filter and never show excluded videos',async()=>{
  const videos=Array.from({length:130},(_,i)=>({id:id(i),title:i<70?'שיר מאושר':'סיפור מאושר'}));
  const a=await app({videos,channels:[]});await inputSearch(a,'שיר');
  assert.equal(a.elements.grid.children.length,60);assert.equal(a.elements.more.hidden,false);
  a.elements.more.listeners.click[0]();assert.equal(a.elements.grid.children.length,70);assert.equal(a.elements.more.hidden,true);
  assert.ok(a.elements.grid.children.every(card=>card.children[1].textContent==='שיר מאושר'));
});
test('tab switching preserves each list search, card limit and scroll position',async()=>{
  const a=await app({videos:[{id:id(1),title:'שיר'}],channels:[{id:A,name:'מאיר'}]},metadataApi);
  await inputSearch(a,'שיר');a.run('visibleCount=120; window.scrollY=440');
  a.elements['channels-tab'].listeners.click[0]();assert.equal(a.elements.search.value,'');assert.equal(a.run('window.scrollY'),0);
  await inputSearch(a,'מאיר');a.run('window.scrollY=180');a.elements['all-tab'].listeners.click[0]();
  assert.equal(a.elements.search.value,'שיר');assert.equal(a.run('visibleCount'),120);assert.equal(a.run('window.scrollY'),440);
  a.elements['channels-tab'].listeners.click[0]();assert.equal(a.elements.search.value,'מאיר');assert.equal(a.run('window.scrollY'),180);
});
test('returning from a channel restores its channel-list search and position',async()=>{
  const a=await app({videos:[],channels:[{id:A,name:'מאיר'}]},metadataApi);
  a.elements['channels-tab'].listeners.click[0]();await inputSearch(a,'מאיר');a.run('window.scrollY=300');clickGrid(a,a.elements.grid.children[0]);
  await inputSearch(a,'2');a.elements['back-channels'].listeners.click[0]();
  assert.equal(a.elements.search.value,'מאיר');assert.equal(a.run('window.scrollY'),300);assert.equal(a.elements['channel-heading'].hidden,true);
  clickGrid(a,a.elements.grid.children[0]);assert.equal(a.elements.search.value,'2');assert.deepEqual(visibleVideoIds(a),[id(2)]);
});
test('closing the app prompt preserves channel, search, more-card limit and scroll',async()=>{
  const a=await app({videos:[],channels:[{id:A,name:'מאיר'}]},url=>url.includes('/channels/')?metadataApi(url):json({videoId:id(2)}));
  a.run(`switchBrowse('channels','${A}')`);await inputSearch(a,'2');a.run('visibleCount=120; window.scrollY=500');
  const card=a.elements.grid.children[0];card.focus();clickGrid(a,card);
  assert.equal(a.elements.player.hidden,false);assert.match(a.elements['app-open-message'].textContent,/Kids YouTube/);
  a.run('window.scrollY=0; closePlayer(true)');
  assert.equal(a.elements.player.hidden,true);
  assert.equal(a.run('selectedChannelId'),A);assert.equal(a.elements.search.value,'2');assert.equal(a.run('visibleCount'),120);
  assert.equal(a.run('window.scrollY'),500);assert.equal(a.document.activeElement,card);
});
test('background render during app prompt restores focus to the replacement card',async()=>{
  const a=await app({videos:[{id:id(1),title:'שיר'}],channels:[]},()=>json({videoId:id(1)}));
  const card=a.elements.grid.children[0];card.focus();a.run(`openPlayer('${id(1)}')`);
  card.isConnected=false;a.run('render(activeConfig,activeLists);closePlayer(true)');
  assert.equal(a.document.activeElement,a.elements.grid.children[0]);
});
test('removed selected channel returns to approved channel list without reviving old videos',async()=>{
  const a=await app({videos:[],channels:[{id:A,name:'מאיר'}]},metadataApi);
  a.run(`switchBrowse('channels','${A}'); render(normalizeConfig({videos:[],channels:[]}),{})`);
  assert.equal(a.run('selectedChannelId'),null);assert.equal(a.run('viewMode'),'channels');assert.equal(a.elements.grid.children.length,0);
  a.run(`switchBrowse('channels','${A}')`);assert.equal(a.run('selectedChannelId'),null);
});
test('channel avatars load automatically, survive outages and show a fallback on image error',async()=>{
  const store=new Map(),image='https://yt3.ggpht.com/example=s176';
  const a=await app(channelLink(A),url=>new URL(url).pathname.endsWith('/'+A)?json({authorId:A,author:'מאיר',authorThumbnails:[{url:image,width:176}]}):metadataApi(url),store);
  a.elements['channels-tab'].listeners.click[0]();const thumb=a.elements.grid.children[0].children[0];
  assert.equal(thumb.children[1].src,image);assert.equal(thumb.children[0].hidden,true);
  thumb.children[1].listeners.error[0]();assert.equal(thumb.children[0].hidden,false);
  const b=await app(channelLink(A),fail,store);b.elements['channels-tab'].listeners.click[0]();
  assert.equal(b.elements.grid.children[0].children[0].children[1].src,image);
});
test('unsafe channel image URLs are rejected and names are inserted as literal text',async()=>{
  const a=await app({videos:[],channels:[{id:A,name:'<img onerror=x>',thumbnail:'https://evil.example/avatar'}]},()=>json({videos:[],continuation:null}));
  a.elements['channels-tab'].listeners.click[0]();assert.equal(a.elements.grid.children[0].children[1].textContent,'<img onerror=x>');
  assert.equal(a.elements.grid.children[0].children[0].children.length,1);
  for(const value of ['javascript:alert(1)','http://yt3.ggpht.com/x','https://yt3.ggpht.com.evil.example/x','https://user:pass@yt3.ggpht.com/x'])assert.equal(a.run(`safeChannelImage(${JSON.stringify(value)})`),'');
});
test('search query is local text, never a URL or an approval',async()=>{
  const a=await app({videos:[{id:id(1),title:'מאושר'}],channels:[]});const count=a.calls.length;
  await inputSearch(a,'https://youtube.com/watch?v='+id(2));assert.equal(a.calls.length,count);assert.equal(a.elements.grid.children.length,0);
  a.run(`openPlayer('${id(2)}')`);assert.equal(a.elements.player.hidden,true);
  await inputSearch(a,'<script>alert(1)</script>');assert.equal(a.calls.length,count);
});
test('navigation stays compact and search controls keep child-sized touch targets',()=>{
  assert.match(html,/\.browse-controls \{ position:sticky/);assert.match(html,/\.tab \{[^}]*min-height:52px/);
  assert.match(html,/<label[^>]*for="search"/);assert.match(html,/id="search" type="search"/);
  assert.match(html,/id="view-grid"/);assert.match(html,/id="view-list"/);assert.match(html,/id="back-channels"/);
  assert.doesNotMatch(html,/api\/v1\/search/);
});

test('three tabs separate manual approvals, whole channels, and deduplicated union',async()=>{
  const a=await app({videos:[{id:id(1),title:'ידני מתוך ערוץ'},{id:id(3),title:'ידני בלבד'},{id:id(4),authorId:A}],channels:[{id:A,name:'ערוץ מאושר'}]},()=>json({videos:[row(1),row(2)],continuation:null}));
  assert.deepEqual(new Set(visibleVideoIds(a)),new Set([id(1),id(2),id(3),id(4)]));
  a.run("switchBrowse('videos')");assert.deepEqual(visibleVideoIds(a),[id(3)]);
  a.run("switchBrowse('channels')");assert.equal(a.elements.grid.children.length,1);assert.equal(a.elements.grid.children[0].dataset.channelId,A);
  assert.match(a.elements.grid.children[0].children[2].textContent,/2 סרטונים נטענו/);
  a.run("switchBrowse('all')");assert.equal(new Set(visibleVideoIds(a)).size,4);
});
test('initial channel load is one page, subsequent pages are requested only on demand',async()=>{
  let page=0;const a=await app({videos:[],channels:[{id:A}]},()=>json({videos:[row(++page)],continuation:page<3?'page'+page:null}));
  assert.equal(page,1);assert.equal(a.elements.more.hidden,false);await a.run('loadMoreVideos()');assert.equal(page,2);await a.run('loadMoreVideos()');assert.equal(page,3);assert.equal(a.elements.more.hidden,true);
});
test('normalization rejects invalid IDs, retains safe dates, and removes duplicate IDs',async()=>{
  const a=await app();assert.equal(a.run("normalizeVideo({id:'invalid'})"),null);
  assert.equal(a.run(`deduplicateVideos([{id:'${id(1)}'},{videoId:'${id(1)}'},{id:'bad'}]).length`),1);
});
test('newest sort and approved channel filter change presentation without API requests',async()=>{
  const a=await app({videos:[{id:id(3),title:'ידני',published:30}],channels:[{id:A}]},()=>json({videos:[{...row(1),published:10},{...row(2),published:20}],continuation:null}));
  const count=a.calls.length;a.elements.sort.value='newest';a.elements.sort.listeners.change[0]();assert.deepEqual(visibleVideoIds(a),[id(3),id(2),id(1)]);
  a.elements['channel-filter'].value=A;a.elements['channel-filter'].listeners.change[0]();assert.deepEqual(visibleVideoIds(a),[id(2),id(1)]);assert.equal(a.calls.length,count);
});
test('newest is the default and sort plus channel filter persist',async()=>{
  const store=new Map(),config={videos:[{id:id(1),title:'ישן',published:10},{id:id(2),title:'חדש',published:20}],channels:[{id:A,name:'ערוץ'}]};
  const a=await app(config,()=>json({videos:[],continuation:null}),store);
  assert.deepEqual(visibleVideoIds(a),[id(2),id(1)]);
  a.elements.sort.value='name';a.elements.sort.listeners.change[0]();
  a.elements['channel-filter'].value=A;a.elements['channel-filter'].listeners.change[0]();
  assert.equal(JSON.parse(store.get('kidsYoutubeSortMode')),'name');
  assert.equal(JSON.parse(store.get('kidsYoutubeChannelFilter')),A);
  const b=await app(config,()=>json({videos:[],continuation:null}),store);
  assert.equal(b.elements.sort.value,'name');assert.equal(b.elements['channel-filter'].value,A);
});
test('search is collapsed until the search button is pressed',async()=>{
  const a=await app({videos:[{id:id(1),title:'שיר'}],channels:[]});
  assert.equal(a.elements['search-row'].hidden,true);
  a.elements['search-toggle'].listeners.click[0]();
  assert.equal(a.elements['search-row'].hidden,false);assert.equal(a.elements['search-toggle'].getAttribute('aria-expanded'),'true');
});
test('saved active search is never hidden when returning to a browse state',async()=>{
  const a=await app({videos:[{id:id(1),title:'שיר אחד'},{id:id(2),title:'שיר אחר'}],channels:[]});
  a.elements['search-toggle'].listeners.click[0]();a.elements.search.value='אחד';a.elements.search.listeners.input[0]();
  await until(()=>a.run('searchTimer')===null);assert.equal(a.elements['search-row'].hidden,false);
  a.run("switchBrowse('videos'); switchBrowse('all')");
  assert.equal(a.run('searchQuery'),'אחד');assert.equal(a.elements['search-row'].hidden,false);
  assert.equal(a.elements['search-toggle'].getAttribute('aria-expanded'),'true');
});
test('pulling down at the top refreshes the authoritative list',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]});const before=a.calls.filter(c=>c.url.includes('/functions/v1/kids-youtube?action=list')).length;
  const target=a.elements.grid;
  a.docListeners.touchstart[0]({touches:[{clientY:10}],target});
  a.docListeners.touchmove[0]({touches:[{clientY:90}],target});
  a.docListeners.touchend[0]({});
  assert.equal(a.elements['pull-refresh'].dataset.loading,'true');
  await until(()=>!a.run('loading'));await new Promise(r=>setTimeout(r,0));
  assert.equal(a.elements['pull-refresh'].dataset.loading,undefined);
  assert.equal(a.calls.filter(c=>c.url.includes('/functions/v1/kids-youtube?action=list')).length,before+1);
});
test('parent catalog sends an approved video to its authenticated host instead of the app deep link',async()=>{
  const sent=[],parentWindow={postMessage:(message,origin)=>sent.push({message,origin})};
  const a=await app({videos:[{id:id(1),title:'מאושר'}],channels:[]},undefined,new Map(),{href:'https://example.test/kids-youtube/?parentCatalog=1',parentWindow});
  a.run(`openPlayer('${id(1)}')`);
  await until(()=>sent.length===1);
  assert.equal(sent.length,1);assert.equal(sent[0].message.id,id(1));assert.equal(sent[0].origin,'https://example.test');
  assert.equal(a.elements.player.hidden,true);
});
test('parent catalog mode requires a same-origin parent frame',async()=>{
  const parentWindow={location:{get origin(){throw new Error('cross-origin');}},postMessage(){throw new Error('must not post');}};
  const a=await app({videos:[{id:id(1)}],channels:[]},undefined,new Map([['kidsParentToken','secret']]),{href:'https://example.test/kids-youtube/?parentCatalog=1',parentWindow});
  assert.equal(a.run('PARENT_CATALOG'),false);
  assert.equal(a.run("safeChannelImage('https://invidious.f5.si/thumb.jpg')"),'https://invidious.f5.si/thumb.jpg');
});

test('parent catalog rejects a different same-origin GitHub Pages path',async()=>{
  const parentWindow={location:{origin:'https://example.test',pathname:'/other-project/parents.html'},postMessage(){throw new Error('must not post');}};
  const a=await app({videos:[{id:id(1)}],channels:[]},undefined,new Map([['kidsParentToken','secret']]),{href:'https://example.test/kids-youtube/?parentCatalog=1',parentWindow});
  assert.equal(a.run('PARENT_CATALOG'),false);
});

test('parent iframe playback is denied when the authoritative grant is revoked',async()=>{
  const config={videos:[{id:id(1),title:'Approved'}],channels:[]};
  const sent=[],parentWindow={postMessage:m=>sent.push(m)};
  const a=await app(config,undefined,new Map(),{href:'https://example.test/kids-youtube/?parentCatalog=1',parentWindow});
  config.videos=[];
  a.run(`openPlayer('${id(1)}')`);
  await until(()=>a.run('displayed.size')===0);
  assert.equal(sent.length,0);
  assert.ok(a.calls.filter(c=>c.url.includes('action=list')).length>=2);
});
test('parent catalog proxies provider calls through authenticated Supabase instead of direct Invidious CORS',async()=>{
  const store=new Map([['kidsParentToken','parent-token']]),parentWindow={postMessage(){}};
  const a=await app(empty,()=>json({software:{name:'test'}}),store,{href:'https://example.test/kids-youtube/?parentCatalog=1',parentWindow});
  const before=a.calls.length;await a.run("providerFetch('https://invidious.tiekoetter.com/api/v1/channels/"+A+"')");
  const call=a.calls.slice(before).at(-1),u=new URL(call.url);
  assert.equal(u.searchParams.get('action'),'provider');
  assert.equal(u.searchParams.get('target'),'https://invidious.tiekoetter.com/api/v1/channels/'+A);
  assert.equal(call.opts.headers.Authorization,'Bearer parent-token');
  assert.equal(a.calls.slice(before).some(x=>x.url.startsWith('https://invidious.')),false);
  await assert.rejects(a.run("providerFetch('https://example.org/api/v1/channels/"+A+"')"),/INVALID_PARENT_PROVIDER/);
});
test('parent proxy synthetic upstream status triggers provider fallback without direct cross-origin requests',async()=>{
  const store=new Map([['kidsParentToken','parent-token']]),parentWindow={postMessage(){}};
  const seen=[];
  const a=await app({videos:[],channels:[{id:A}]},url=>{
    const target=new URL(url).searchParams.get('target')||'';
    seen.push(target);
    if(target.startsWith('https://invidious.f5.si/'))return json({error:'UPSTREAM_UNAVAILABLE'},{headers:{'x-kids-provider-status':'403'}});
    return json({videos:[row(1)],continuation:null});
  },store,{href:'https://example.test/kids-youtube/?parentCatalog=1',parentWindow});
  assert.equal(a.run('displayed.size'),1);
  assert.ok(seen.some(x=>x.startsWith('https://invidious.f5.si/')));
  assert.ok(seen.some(x=>x.startsWith('https://invidious.tiekoetter.com/')));
  assert.equal(a.calls.some(x=>/^https:\/\/(?:invidious|yt\.)/.test(x.url)),false);
});
test('parent catalog CSP and channel images never grant direct Invidious browser access',async()=>{
  const parent=await app(empty,undefined,new Map(),{href:'https://example.test/kids-youtube/?parentCatalog=1',parentWindow:{postMessage(){}}});
  const meta=parent.document.head.children[0];assert.match(meta.content,/connect-src 'self' https:\/\/jxhelpxhrmwvzrrfrjuh\.supabase\.co/);
  assert.doesNotMatch(meta.content,/connect-src[^;]*invidious|connect-src[^;]*chocolatemoo/);
  assert.equal(parent.run("safeChannelImage('https://invidious.f5.si/thumb.jpg')"),'');
  assert.equal(parent.run("safeChannelImage('https://yt3.googleusercontent.com/thumb.jpg')"),'https://yt3.googleusercontent.com/thumb.jpg');
});

test('parent catalog thumbnails load eagerly and child thumbnails remain lazy',async()=>{
  const parent=await app({videos:[{id:id(1),title:'מאושר'}],channels:[]},undefined,new Map(),{href:'https://example.test/kids-youtube/?parentCatalog=1',parentWindow:{postMessage(){}}});
  assert.equal(parent.elements.grid.children[0].children[0].children[0].loading,'eager');
  const child=await app({videos:[{id:id(1),title:'מאושר'}],channels:[]});
  assert.equal(child.elements.grid.children[0].children[0].children[0].loading,'lazy');
});
test('approval freshness polling is reduced to one minute and disabled inside parent catalog',()=>{
  assert.match(scripts[1],/authorizationRefreshMs:\s*60\s*\*\s*1000/);
  assert.match(scripts[1],/if \(typeof setInterval === 'function' && !PARENT_CATALOG\)/);
  assert.match(scripts[1],/if\(!NATIVE_MODE\)setInterval/);
  assert.doesNotMatch(scripts[1],/if\(!PARENT_CATALOG\)setInterval\(checkAuthorizationFreshness/);
});


test('authorization change detected during pagination fails closed immediately and queues a reload',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]});
  a.run('paginationBusy=true');
  a.context.fetch=async url=>String(url).includes('action=list')?json({list:JSON.stringify({videos:[{id:id(2)}],channels:[]}),updatedAt:'changed'}):fail();
  await a.run('checkAuthorizationFreshness()');
  assert.equal(a.run('displayed.size'),0);
  assert.equal(a.run('authorizationReloadPending'),true);
  assert.match(a.elements['status-text'].textContent,/רשימת ההורה השתנתה/);
});
test('native-app launch visibility listener is cleaned up even when the app is not installed',async()=>{
  const a=await app({videos:[{id:id(1),title:'סרטון'}],channels:[]},undefined,new Map(),{timerCap:5});
  const before=(a.docListeners.visibilitychange||[]).length;
  a.run(`openPlayer('${id(1)}');launchNativeApp()`);
  assert.equal((a.docListeners.visibilitychange||[]).length,before+1);
  await new Promise(r=>setTimeout(r,12));
  assert.equal((a.docListeners.visibilitychange||[]).length,before);
});
test('re-rendering keeps existing thumbnail nodes rather than issuing duplicate loads',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]});const image=a.elements.grid.children[0].children[0].children[0];a.run('render(activeConfig,activeLists)');assert.equal(a.elements.grid.children[0].children[0].children[0],image);assert.equal(image.loading,'lazy');
});
test('foreground after a long absence performs one full authorization refresh, not duplicate list requests',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]});
  const before=a.calls.filter(x=>x.url.includes('action=list')).length;
  a.run('lastLoad=0');a.document.hidden=false;a.docListeners.visibilitychange[0]();
  await until(()=>!a.run('loading'));
  assert.equal(a.calls.filter(x=>x.url.includes('action=list')).length,before+1);
});
test('online recovery resets cooldown and refreshes whitelist',async()=>{
  const a=await app();const initial=a.calls.length;a.listeners.offline[0]();assert.match(a.elements['status-text'].textContent,/אין חיבור/);a.listeners.online[0]();await until(()=>!a.run('loading'));assert.equal(a.calls.length,initial+1);
});
test('clear-cache control evicts API data while preserving parent whitelist source',async()=>{
  const a=await app(link(1),metadataApi);assert.ok(a.run('providers.snapshot().cacheEntries')>0);a.elements['clear-cache'].listeners.click[0]();await until(()=>!a.run('loading'));assert.equal(a.run('displayed.size'),1);assert.equal(a.calls.filter(c=>c.url.includes('/functions/v1/kids-youtube?action=list')).length,2);
});
test('search debounce collapses rapid input and preserves pending input on background render',async()=>{
  const a=await app({videos:[{id:id(1),title:'שיר'}],channels:[]});
  a.elements.search.value='ש';a.elements.search.listeners.input[0]();a.elements.search.value='שיר';a.elements.search.listeners.input[0]();a.run('render(activeConfig,activeLists)');assert.equal(a.elements.search.value,'שיר');
  await until(()=>a.run('searchTimer')===null);assert.deepEqual(visibleVideoIds(a),[id(1)]);
});

test('metadata updates reuse thumbnail nodes while updating literal title and author text',async()=>{
  const a=await app({videos:[{id:id(1),title:'ישן'}],channels:[]});const image=a.elements.grid.children[0].children[0].children[0];
  a.run(`render(normalizeConfig({videos:[{id:'${id(1)}',title:'חדש',author:'<img onerror=x>',published:123}],channels:[]}),{})`);
  const card=a.elements.grid.children[0];assert.equal(card.children[0].children[0],image);assert.equal(card.children[1].textContent,'חדש');assert.equal(card.children[2].textContent,'<img onerror=x>');
});

test('parent frame CSP permits only its trusted local bridge',async()=>{
  const a=await app();const meta=a.document.head.children[0];assert.equal(meta.httpEquiv,'Content-Security-Policy');
  assert.match(meta.content,/frame-src 'self'/);assert.match(meta.content,/object-src 'none'/);assert.doesNotMatch(meta.content,/example\.test|\*|data:|blob:/);
});

test('global channel filter does not hide manual approvals or block pagination inside another channel',async()=>{
  const a=await app({videos:[{id:id(9),title:'ידני'}],channels:[{id:A},{id:B}]},url=>{
    const channel=url.includes(A)?A:B;return json({videos:[row(new URL(url).searchParams.has('continuation')?3:channel===A?1:2,channel)],continuation:new URL(url).searchParams.has('continuation')?null:'next'});
  });
  a.run(`channelFilter='${A}';switchBrowse('videos')`);assert.deepEqual(visibleVideoIds(a),[id(9)]);
  a.run(`switchBrowse('channels','${B}')`);assert.equal(a.elements['channel-filter'].value,B);assert.equal(a.elements.more.hidden,false);
  const before=a.calls.length;await a.run('loadMoreVideos()');assert.equal(a.calls.length,before+1);assert.deepEqual(visibleVideoIds(a),[id(2),id(3)]);
});


test('late Supabase approval response cannot revive cards after fail-closed',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]});
  let complete;a.context.fetch=()=>new Promise(resolve=>complete=resolve);
  const pending=a.run('loadApp()');await until(()=>typeof complete==='function');
  a.run("failClosedAuthorization('אימות נכשל')");
  complete(json({list:JSON.stringify({videos:[{id:id(1)}],channels:[]}),updatedAt:'old'}));
  await pending;assert.equal(a.run('displayed.size'),0);
  assert.equal(a.elements.grid.children.length,0);assert.equal(a.run('approvalMarker'),'');
});
test('late Invidious channel response cannot revive cards after fail-closed',async()=>{
  let finish,hold=false;
  const a=await app({videos:[],channels:[{id:A}]},()=>hold?new Promise(resolve=>finish=resolve):json({videos:[],continuation:null}));
  hold=true;a.run('providers.clearCache()');
  const pending=a.run('loadApp()');await until(()=>typeof finish==='function');
  a.run("failClosedAuthorization('האישור בוטל')");
  finish(json({videos:[row(8)],continuation:null}));
  await pending;assert.equal(a.run('displayed.size'),0);assert.equal(a.elements.grid.children.length,0);
});

test('warm canonical-video startup uses saved display metadata without provider rediscovery',async()=>{
  const videoUrl='https://www.youtube.com/watch?v='+id(1);
  const store=new Map(),config=videoUrl+'\n';
  const first=await app(config,()=>json({videoId:id(1),title:'כותרת מוכנה',author:'ערוץ מאיר',authorId:A}),store);
  assert.equal(first.run(`displayed.get('${id(1)}').title`),'כותרת מוכנה');
  // Deliberately remove the provider cache, leaving only the approved-ID
  // display snapshot, to prove it is the app's own persistence that saves work.
  for(const key of [...store.keys()])if(key.startsWith('kidsYoutubeData:'))store.delete(key);
  const warm=await app(config,()=>{throw Error('Should not fetch provider metadata');},store);
  assert.equal(warm.run(`displayed.get('${id(1)}').title`),'כותרת מוכנה');
  assert.equal(warm.calls.length,1);
  assert.equal(warm.run('catalogMetrics.providerCalls'),0);
  assert.ok(warm.run('catalogMetrics.displayCacheHits')>=1);
});
test('approved explicit note is a safe visible title until metadata arrives',async()=>{
  const videoUrl='https://www.youtube.com/watch?v='+id(1);
  const a=await app(videoUrl+' // השם שההורה בחר\n',()=>json({videoId:id(1),title:'כותרת אמיתית',authorId:A}));
  assert.equal(a.run(`displayed.get('${id(1)}').title`),'כותרת אמיתית');
  const parsed=a.run(`parseLinkList('${videoUrl} // השם שההורה בחר').entries[0].label`);
  assert.equal(parsed,'השם שההורה בחר');
  const fallback=a.run(`cachedLinkRecord(parseLinkList('${videoUrl} // השם שההורה בחר').entries[0],{}).title`);
  assert.equal(fallback,'השם שההורה בחר');
});
test('startup renders a batch of incoming metadata rather than a card rebuild per link',async()=>{
  const rows=Array.from({length:12},(_,i)=>'https://www.youtube.com/watch?v='+id(i+1)).join('\n');
  const a=await app(rows,url=>{
    const m=url.match(/\/api\/v1\/videos\/([A-Za-z0-9_-]{11})/);
    return json({videoId:m?.[1],title:'מוכן '+m?.[1],authorId:A});
  });
  assert.equal(a.run('displayed.size'),12);
  const count=a.run('catalogMetrics.renderCalls');
  assert.ok(count<=9,'renderCalls='+count+' should be fewer than 12 metadata results');
  assert.equal(a.run('catalogMetrics.providerCalls'),12);
});
test('partial provider failures schedule bounded automatic retries with no rapid polling',async()=>{
  const a=await app({videos:[],channels:[{id:A}]},()=>{throw Error('offline provider');},new Map(),{timerCap:5});
  await until(()=>a.run('catalogRetryAttempts')===3);
  assert.equal(a.run('catalogRetryAttempts'),3);
  assert.ok(a.run('catalogMetrics.retries')>=2);
  assert.equal(a.run('displayed.size'),0);
});

test('measured warm startup reduces provider requests and metadata phase duration',async()=>{
  const list=Array.from({length:9},(_,i)=>'https://www.youtube.com/watch?v='+id(i+1)).join('\n');
  const store=new Map();
  const cold=await app(list,async url=>{
    await new Promise(resolve=>setTimeout(resolve,25));
    const match=url.match(/\/api\/v1\/videos\/([A-Za-z0-9_-]{11})/);
    return json({videoId:match?.[1],title:'מוכן',authorId:A});
  },store);
  const coldProvider=cold.run('catalogMetrics.providerCalls'),coldMetadataMs=cold.run('catalogMetrics.metadataMs');
  for(const key of [...store.keys()])if(key.startsWith('kidsYoutubeData:'))store.delete(key);
  const warm=await app(list,()=>{throw Error('No rediscovery expected')},store);
  const warmProvider=warm.run('catalogMetrics.providerCalls'),warmMetadataMs=warm.run('catalogMetrics.metadataMs');
  assert.equal(coldProvider,9);assert.equal(warmProvider,0);
  assert.ok(coldMetadataMs>=45,'expected a measurable simulated cold metadata phase: '+coldMetadataMs);
  assert.ok(warmMetadataMs<coldMetadataMs,'warm '+warmMetadataMs+' vs cold '+coldMetadataMs);
  console.log('SIMULATED_CATALOG_BENCHMARK coldProviders='+coldProvider+
    ' warmProviders='+warmProvider+' coldMetadataMs='+coldMetadataMs+' warmMetadataMs='+warmMetadataMs);
});

test('warm channel catalog restores validated pagination cursor without reloading first pages',async()=>{
  const store=new Map(),config={videos:[],channels:[{id:A,name:'ערוץ'}]};
  const first=await app(config,url=>{
    const token=new URL(url).searchParams.get('continuation');
    if(token==='two')return json({videos:[row(2)],continuation:'three'});
    if(token==='three')return json({videos:[row(3)],continuation:null});
    return json({videos:[row(1)],continuation:'two'});
  },store);
  assert.equal(first.run('displayed.size'),1);
  await first.run('loadMoreVideos()');assert.equal(first.run('displayed.size'),2);
  const saved=JSON.parse(store.get('kidsYoutubeVideos'));
  assert.equal(saved.channelProgress[A].continuation,'three');
  for(const key of [...store.keys()])if(key.startsWith('kidsYoutubeData:'))store.delete(key);
  const warm=await app(config,url=>{
    assert.equal(new URL(url).searchParams.get('continuation'),'three');
    return json({videos:[row(3)],continuation:null});
  },store);
  assert.equal(warm.run('displayed.size'),2);
  assert.equal(warm.calls.length,1,'fresh auth only, no channel page rediscovery');
  await warm.run('loadMoreVideos()');
  assert.equal(warm.run('displayed.size'),3);
  assert.equal(warm.calls.length,2,'only next continuation requested');
});
test('an expired channel cursor is discarded but cached content remains only after authorization',async()=>{
  const store=new Map(),config={videos:[],channels:[{id:A}]};
  await app(config,()=>json({videos:[row(1)],continuation:'two'}),store);
  const snapshot=JSON.parse(store.get('kidsYoutubeVideos'));
  snapshot.channelDates[A]=Date.now()-6*60*1000;
  store.set('kidsYoutubeVideos',JSON.stringify(snapshot));
  for(const key of [...store.keys()])if(key.startsWith('kidsYoutubeData:'))store.delete(key);
  const next=await app(config,()=>json({videos:[row(2)],continuation:null}),store);
  assert.ok(next.calls.length>1,'expired cursor forces a fresh first-page request');
  assert.equal(next.run('displayed.size'),1,'a fresh complete channel page replaces old content');
  assert.equal(next.run(`displayed.has('${id(2)}')`),true);
  const removed=await app(empty,()=>{throw Error('provider should never authorize revoked content')},store);
  assert.equal(removed.run('displayed.size'),0);
});

test('an automatic retry postponed in background resumes on foreground with fresh authorization',async()=>{
  const a=await app({videos:[],channels:[{id:A}]},()=>{throw Error('temporary upstream error')},new Map(),{timerCap:15});
  a.document.hidden=true;
  await until(()=>a.run('catalogRetryPending')===true);
  const previous=a.calls.filter(x=>x.url.includes('action=list')).length;
  a.document.hidden=false;a.docListeners.visibilitychange[0]();
  await until(()=>a.calls.filter(x=>x.url.includes('action=list')).length>previous);
  assert.equal(a.run('catalogRetryPending'),false);
  assert.ok(a.run('catalogMetrics.retries')>=1);
});

test('new device with empty storage renders shared server-prepared video and channel after live authorization',async()=>{
  const now=new Date().toISOString(),list='https://www.youtube.com/watch?v='+id(1)+'\nhttps://www.youtube.com/channel/'+A+'\n';
  const catalog={version:7,updatedAt:'stable',entries:[
    {approval_url:'https://www.youtube.com/watch?v='+id(1),kind:'video',item_id:id(1),
      title:'שם מוכן מהשרת',thumbnail:'https://img.youtube.com/vi/'+id(1)+'/hqdefault.jpg',published:1234,channel_id:A,checked_at:now},
    {approval_url:'https://www.youtube.com/channel/'+A,kind:'channel',item_id:A,title:'ערוץ מוכן מהשרת',
      thumbnail:'https://yt3.googleusercontent.com/example',page:[{id:id(2),videoId:id(2),title:'סרטון מהערוץ',channelId:A,authorId:A}],
      pages_loaded:1,continuation:null,complete:true,checked_at:now}
  ]};
  const a=await app(list,()=>{throw Error('No provider discovery expected on prepared first opening');},new Map(),{sharedCatalog:catalog});
  assert.equal(a.run('displayed.size'),2);
  assert.equal(a.run(`displayed.get('${id(1)}').title`),'שם מוכן מהשרת');
  assert.equal(a.run(`displayed.get('${id(2)}').title`),'סרטון מהערוץ');
  assert.equal(a.run('catalogMetrics.providerCalls'),0);
  assert.equal(a.calls.length,2,'one live authorization plus one catalog read');
});
test('server catalog is never a grant after the same content has been removed',async()=>{
  const catalog={version:7,updatedAt:'stable',entries:[{approval_url:'https://www.youtube.com/watch?v='+id(1),
    kind:'video',item_id:id(1),title:'אסור',checked_at:new Date().toISOString()}]};
  const a=await app('',()=>{throw Error('No provider needed');},new Map(),{sharedCatalog:catalog});
  assert.equal(a.run('displayed.size'),0);assert.equal(a.elements.grid.children.length,0);
});
test('shared catalog with a mismatched grant version fails closed even if it has valid metadata',async()=>{
  const catalog={version:6,updatedAt:'stable',entries:[{approval_url:'https://www.youtube.com/watch?v='+id(1),
    kind:'video',item_id:id(1),title:'ישן',checked_at:new Date().toISOString()}]};
  const a=await app('https://www.youtube.com/watch?v='+id(1),()=>{throw Error('No provider');},new Map(),{sharedCatalog:catalog,grantVersion:7});
  assert.equal(a.run('displayed.size'),0);assert.equal(a.run('approvalMarker'),'');
});

test('native first-run prepared channel page never sends an Invidious cursor to NewPipe',async()=>{
  const now=new Date().toISOString();
  const catalog={version:7,updatedAt:'stable',entries:[{
    approval_url:'https://www.youtube.com/channel/'+A,kind:'channel',item_id:A,
    title:'מוכן מהשרת',page:[{id:id(1),videoId:id(1),title:'סרטון מוכן',channelId:A,authorId:A}],
    pages_loaded:1,continuation:'invidious-opaque-cursor',complete:false,checked_at:now
  }]};
  const list='https://www.youtube.com/channel/'+A+'\n';
  const a=await app(list,url=>{
    assert.doesNotMatch(url,/invidious-opaque-cursor/);
    return json({videos:[row(1),row(2)],continuation:'native-token'});
  },new Map(),{nativeMode:true,sharedCatalog:catalog});
  assert.equal(a.run('displayed.size'),1);
  assert.equal(a.run('catalogMetrics.providerCalls'),0);
  await a.run('loadMoreVideos()');
  assert.equal(a.run('displayed.size'),2);
  assert.equal(a.run('channelProgress.get('+JSON.stringify(A)+').continuation'),'native-token');
});

test('two directly approved videos survive metadata and channel outages and later retry',async()=>{
  const video1='https://www.youtube.com/watch?v='+id(1);
  const video2='https://www.youtube.com/watch?v='+id(2);
  const raw=[video1,video2,'https://www.youtube.com/channel/'+A].join('\n');
  const a=await app(raw,()=>{throw Error('provider down');},new Map(),{timerCap:10});
  assert.equal(a.run('displayed.size'),2);
  assert.equal(a.run(`displayed.has('${id(1)}')`),true);
  assert.equal(a.run(`displayed.has('${id(2)}')`),true);
  assert.match(a.run(`displayed.get('${id(1)}').title`),/סרטון מאושר/);
  await until(()=>a.run('catalogMetrics.retries')>=1);
  assert.equal(a.run('displayed.size'),2,'retry must not erase direct parent approvals');
  assert.equal(a.run(`displayed.has('${id(1)}')`),true);
  assert.equal(a.run(`displayed.has('${id(2)}')`),true);
});

test('approved legacy handle uses only the matching current server UC record; cached channel page survives provider outage',async()=>{
  const handle='https://www.youtube.com/@meirshows',channel='UCV6xoqUxJzkWwCbDmEwMSYw';
  const target=id(4),when=new Date().toISOString();
  const catalog={version:3,updatedAt:'stable',entries:[{
    approval_url:handle,kind:'channel',item_id:channel,title:'ערוץ מאיר',
    page:[{id:target,videoId:target,title:'סרטון מהערוץ',channelId:channel,authorId:channel}],
    pages_loaded:1,complete:true,continuation:null,checked_at:when
  }]};
  const a=await app(handle+'\n',()=>{throw Error('Invidious must not be required for current pinned entry')},new Map(),{sharedCatalog:catalog});
  assert.equal(a.run('displayed.size'),1);
  assert.equal(a.run(`displayed.get('${target}').title`),'סרטון מהערוץ');
  assert.equal(a.run('catalogMetrics.providerCalls'),0);
  const revoked=await app('',()=>{throw Error('provider not required')},new Map(),{sharedCatalog:catalog});
  assert.equal(revoked.run('displayed.size'),0);
});
test('legacy handle mapping only in localStorage must not grant channel access',async()=>{
  const handle='https://www.youtube.com/@meirshows',channel='UCV6xoqUxJzkWwCbDmEwMSYw';
  const store=new Map([['kidsYoutubeVideos',JSON.stringify({
    scope:'https://example.test/kids-youtube/',version:2,savedAt:Date.now(),
    config:{videos:[],channels:[{id:channel}]},channelLists:{[channel]:[{id:id(9),channelId:channel}]},
    linkRecords:{[handle]:{kind:'channel',id:channel,name:'מיפוי ישן'}}
  })]]);
  const a=await app(handle+'\n',()=>{throw Error('provider unavailable')},store);
  assert.equal(a.run('displayed.size'),0);
});

test('device startup list timeout retries successfully into 17 server-prepared approved videos without manual refresh',async()=>{
  const C='UCV6xoqUxJzkWwCbDmEwMSYw',channel='https://www.youtube.com/channel/'+C;
  const vids=Array.from({length:17},(_,i)=>id(i+1));
  const list=vids.slice(0,2).map(v=>'https://www.youtube.com/watch?v='+v).concat(channel).join('\n')+'\n';
  const checked=new Date().toISOString();
  const catalog={version:3,updatedAt:'stable',entries:[
    ...vids.slice(0,2).map(v=>({approval_url:'https://www.youtube.com/watch?v='+v,kind:'video',item_id:v,title:'שם מוכן '+v,checked_at:checked})),
    {approval_url:channel,kind:'channel',item_id:C,title:'ערוץ מוכן',checked_at:checked,pages_loaded:1,complete:false,
     page:vids.slice(2).map(v=>({id:v,videoId:v,channelId:C,authorId:C,title:'שם סרטון '+v}))}
  ]};
  let authCalls=0;
  const a=await app(list,()=>{throw Error('Channel page should be deferred when prepared')},new Map(),{
    nativeMode:true,sharedCatalog:catalog,timerCap:8,
    nativeFetchAuthorization:async()=>{
      if(++authCalls===1)throw Object.assign(new Error('TIMEOUT'),{code:'TIMEOUT'});
      return {list,version:3,updatedAt:'stable',catalogVersion:1,preparedCatalog:catalog};
    }
  });
  await until(()=>a.run('displayed.size')===17);
  assert.equal(authCalls>=2,true);
  assert.equal(a.run('displayed.size'),17);
  assert.equal(a.run('approvalMarker')!=='',true);
  assert.ok(a.run('catalogMetrics.authorizationMs')>=0);
});
test('late failed poll cannot clear a newer successful loading cycle',async()=>{
  const list='https://www.youtube.com/watch?v='+id(1)+'\n';
  let authCalls=0,rejectOldPoll;
  const a=await app(list,()=>json({videoId:id(1),title:'מוכן',authorId:A}),new Map(),{
    listFetch:()=>{
      authCalls++;
      if(authCalls===2)return new Promise((_,reject)=>{rejectOldPoll=reject;});
      return json({list,updatedAt:'stable'});
    }
  });
  assert.equal(a.run('displayed.size'),1);
  const poll=a.run("checkAuthorizationFreshness('poll')");
  await until(()=>!!rejectOldPoll);
  const refresh=a.run('loadApp()');
  await refresh;assert.equal(a.run('displayed.size'),1);
  const generation=a.run('authorizationGeneration');
  rejectOldPoll(new Error('TIMEOUT'));await poll;
  assert.equal(a.run('authorizationGeneration'),generation);
  assert.equal(a.run('displayed.size'),1);
  assert.match(a.run('approvalMarker'),/watch/);
});
test('real failed fresh poll fails closed, rejects prior cards and schedules a bounded authorization retry',async()=>{
  const list='https://www.youtube.com/watch?v='+id(2)+'\n';
  let calls=0;
  const a=await app(list,()=>json({videoId:id(2),title:'מוכן',authorId:A}),new Map(),{
    timerCap:25,
    listFetch:()=>++calls===1?json({list,updatedAt:'stable'}):new Promise(()=>{})
  });
  await a.run("checkAuthorizationFreshness('poll')");
  assert.equal(a.run('displayed.size'),0);
  assert.equal(a.run('approvalMarker'),'');
  assert.equal(a.run('authorizationRetryAttempts')>=1,true);
});
test('provider page failure after successful grant verification cannot erase 17 prepared cards',async()=>{
  const C='UCV6xoqUxJzkWwCbDmEwMSYw',channel='https://www.youtube.com/channel/'+C;
  const vids=Array.from({length:17},(_,i)=>id(i+1)),now=new Date().toISOString();
  const list=vids.slice(0,2).map(v=>'https://www.youtube.com/watch?v='+v).concat(channel).join('\n')+'\n';
  const catalog={version:3,updatedAt:'stable',entries:[
    ...vids.slice(0,2).map(v=>({approval_url:'https://www.youtube.com/watch?v='+v,kind:'video',item_id:v,title:'מוכן',checked_at:now})),
    {approval_url:channel,kind:'channel',item_id:C,title:'ערוץ מוכן',checked_at:now,pages_loaded:1,complete:false,
    page:vids.slice(2).map(v=>({id:v,videoId:v,authorId:C,channelId:C,title:'מוכן'}))}
  ]};
  const a=await app(list,()=>{throw Error('UPSTREAM_BLOCKED')},new Map(),{nativeMode:true,sharedCatalog:catalog});
  assert.equal(a.run('displayed.size'),17);
  assert.equal(a.run('pendingChannelRetry.has('+JSON.stringify(C)+')'),true);
  const generation=a.run('authorizationGeneration');
  await a.run('retryCatalogContents()');
  assert.equal(a.run('displayed.size'),17);
  assert.equal(a.run('authorizationGeneration'),generation);
  assert.equal(a.run('approvalMarker')!=='',true);
  assert.doesNotMatch(a.elements['status-text'].textContent,/לא הצלחנו לאמת כרגע/);
});
test('pending channel page response arriving after an authoritative revocation is ignored',async()=>{
  const C='UCV6xoqUxJzkWwCbDmEwMSYw',channel='https://www.youtube.com/channel/'+C,now=new Date().toISOString();
  const list=channel+'\n',catalog={version:3,updatedAt:'stable',entries:[{
    approval_url:channel,kind:'channel',item_id:C,title:'ערוץ',checked_at:now,pages_loaded:1,complete:false,
    page:[{id:id(1),videoId:id(1),channelId:C,authorId:C,title:'מוכן'}]}]};
  let finish;
  const a=await app(list,()=>new Promise(resolve=>finish=resolve),new Map(),{nativeMode:true,sharedCatalog:catalog});
  assert.equal(a.run('displayed.size'),1);
  const pending=a.run('retryCatalogContents()');
  await until(()=>typeof finish==='function');
  a.run("failClosedAuthorization('ההרשאה הוסרה','test')");
  finish(json({videos:[row(9,C)],continuation:null}));
  await pending;
  assert.equal(a.run('displayed.size'),0);
  assert.equal(a.run('approvalMarker'),'');
});

test('poll and partial-channel retry cannot issue competing list checks',async()=>{
 const C='UCV6xoqUxJzkWwCbDmEwMSYw',channel='https://www.youtube.com/channel/'+C,now=new Date().toISOString();
 const list=channel+'\n';
 const catalog={version:3,updatedAt:'stable',entries:[{approval_url:channel,kind:'channel',item_id:C,title:'ערוץ',checked_at:now,pages_loaded:1,complete:false,
 page:[{id:id(1),videoId:id(1),channelId:C,authorId:C,title:'מוכן'}]}]};
 let finish;
 const a=await app(list,()=>new Promise(resolve=>finish=resolve),new Map(),{nativeMode:true,sharedCatalog:catalog});
 const before=a.calls.filter(x=>x.url.includes('action=list')).length;
 const retry=a.run('retryCatalogContents()');
 await until(()=>typeof finish==='function');
 await a.run("checkAuthorizationFreshness('poll')");
 assert.equal(a.calls.filter(x=>x.url.includes('action=list')).length,before,
   'Android must not send a competing WebView authority request');
 finish(json({videos:[row(2,C)],continuation:null}));
 await retry;
 assert.equal(a.run('displayed.size'),2);
});
test('partial-channel response arriving after backgrounding stays pending and never modifies inactive UI',async()=>{
 const C='UCV6xoqUxJzkWwCbDmEwMSYw',channel='https://www.youtube.com/channel/'+C,now=new Date().toISOString(),list=channel+'\n';
 const catalog={version:3,updatedAt:'stable',entries:[{approval_url:channel,kind:'channel',item_id:C,title:'ערוץ',checked_at:now,pages_loaded:1,complete:false,
 page:[{id:id(1),videoId:id(1),channelId:C,authorId:C,title:'מוכן'}]}]};
 let finish;
 const a=await app(list,()=>new Promise(resolve=>finish=resolve),new Map(),{nativeMode:true,sharedCatalog:catalog});
 const retry=a.run('retryCatalogContents()');
 await until(()=>typeof finish==='function');
 a.document.hidden=true;
 finish(json({videos:[row(2,C)],continuation:null}));
 await retry;
 assert.equal(a.run('displayed.size'),1);
 assert.equal(a.run('catalogRetryPending'),true);
});
test('debug request trace identifies list timeout source and later authorization without exposing URLs or tokens',async()=>{
 const logs=[],list='https://www.youtube.com/watch?v='+id(1)+'\n';
 let n=0;
 const a=await app(list,()=>json({videoId:id(1),title:'מוכן',authorId:A}),new Map(),{
 nativeMode:true,timerCap:8,logCollector:logs,
 listFetch:()=>++n===1?new Promise(()=>{}):json({list,updatedAt:'stable'})
 });
 await until(()=>a.run('displayed.size')===1);
 const records=logs.filter(x=>x.startsWith('KidsCatalog '));
 assert.ok(records.some(x=>x.includes('request-start')&&x.includes('"kind":"list"')));
 assert.ok(records.some(x=>x.includes('request-end')&&x.includes('"outcome":"TIMEOUT"')));
 assert.ok(records.some(x=>x.includes('authorization-ok')));
 assert.equal(records.some(x=>x.includes('https://')||x.includes('Bearer ')),false);
});

test('Android first load and periodic verification share the native authoritative transport, not WebView HTTP',async()=>{
 const list='https://www.youtube.com/watch?v='+id(1)+'\n';
 const calls=[];
 const doc={list,version:3,updatedAt:'2026-10-08T16:28:30Z',catalogVersion:1,preparedCatalog:{
    version:3,updatedAt:'2026-10-08T16:28:30Z',entries:[{
      approval_url:'https://www.youtube.com/watch?v='+id(1),kind:'video',
      item_id:id(1),title:'שם מהשרת',checked_at:new Date().toISOString()
    }]
  }};
 const a=await app(list,()=>json({videoId:id(1),title:'מוכן',authorId:A}),new Map(),{
   nativeMode:true,
   nativeFetchAuthorization:async()=>{calls.push('native-authorization');return doc;},
   listFetch:()=>{throw Error('WebView must not request native grants over a second transport');},
   sharedCatalog:{version:3,updatedAt:doc.updatedAt,entries:[
     {approval_url:'https://www.youtube.com/watch?v='+id(1),kind:'video',item_id:id(1),title:'שם מהשרת',
      checked_at:new Date().toISOString()}
   ]}
 });
 assert.equal(a.run('displayed.size'),1);
 assert.equal(a.run(`displayed.get('${id(1)}').title`),'שם מהשרת');
 assert.equal(calls.length,1);
 assert.equal(a.calls.filter(x=>x.url.includes('action=list')).length,0);
 await a.run("checkAuthorizationFreshness('poll')");
 assert.equal(calls.length,2);
 assert.equal(a.calls.filter(x=>x.url.includes('action=list')).length,0);
 assert.equal(a.run('displayed.size'),1);
});
test('Android native whitelist failure remains fail-closed instead of falling back to browser grants',async()=>{
 const raw='https://www.youtube.com/watch?v='+id(2)+'\n';
 const a=await app(raw,()=>json({videoId:id(2),title:'מוכן',authorId:A}),new Map(),{
 nativeMode:true,nativeFetchAuthorization:async()=>{throw Object.assign(new Error('TIMEOUT'),{code:'TIMEOUT'})},
 listFetch:()=>{throw Error('Forbidden silent fallback');}
 });
 assert.equal(a.run('displayed.size'),0);
 assert.equal(a.run('approvalMarker'),'');
 assert.equal(a.calls.filter(x=>x.url.includes('action=list')).length,0);
});

test('optional partial-channel retry auth timeout keeps 17 freshly approved prepared cards',async()=>{
  const C='UCV6xoqUxJzkWwCbDmEwMSYw',channel='https://www.youtube.com/channel/'+C;
  const vids=Array.from({length:17},(_,i)=>id(i+1)),now=new Date().toISOString();
  const list=vids.slice(0,2).map(v=>'https://www.youtube.com/watch?v='+v).concat(channel).join('\n')+'\n';
  const catalog={version:3,updatedAt:'stable',entries:[
    ...vids.slice(0,2).map(v=>({approval_url:'https://www.youtube.com/watch?v='+v,kind:'video',item_id:v,title:'מוכן',checked_at:now})),
    {approval_url:channel,kind:'channel',item_id:C,title:'ערוץ מוכן',checked_at:now,pages_loaded:1,complete:false,
      page:vids.slice(2).map(v=>({id:v,videoId:v,authorId:C,channelId:C,title:'מוכן'}))}
  ]};
  let authCalls=0;
  const a=await app(list,()=>{throw Error('UPSTREAM_BLOCKED')},new Map(),{
    nativeMode:true,timerCap:20,sharedCatalog:catalog,
    nativeFetchAuthorization:async()=>{
      authCalls++;
      if(authCalls===1)return {list,version:3,updatedAt:'stable',catalogVersion:1,preparedCatalog:catalog};
      throw Object.assign(new Error('TIMEOUT'),{code:'TIMEOUT'});
    }
  });
  assert.equal(a.run('displayed.size'),17);
  assert.equal(a.run('pendingChannelRetry.has('+JSON.stringify(C)+')'),true);
  const generation=a.run('authorizationGeneration');
  await a.run('retryCatalogContents()');
  assert.equal(a.run('displayed.size'),17);
  assert.equal(a.run('authorizationGeneration'),generation);
  assert.notEqual(a.run('approvalMarker'),'');
  assert.doesNotMatch(a.elements['status-text'].textContent,/לא הצלחנו לאמת כרגע/);
});

test('Android with no embedded catalog skips both browser and native catalog fetches',async()=>{
 const list='https://www.youtube.com/watch?v='+id(1)+'\n';
 const catalog={version:3,updatedAt:'fresh',entries:[{
   approval_url:'https://www.youtube.com/watch?v='+id(1),kind:'video',item_id:id(1),
   title:'שם מוכן מהשרת',checked_at:new Date().toISOString()
 }]};
 let nativeCalls=0,extractorCalls=0;
 const a=await app(list,()=>{extractorCalls++;throw Error('No NewPipe discovery expected')},new Map(),{
   nativeMode:true,sharedCatalog:catalog,
   nativeFetchAuthorization:async()=>({list,version:3,updatedAt:'fresh',catalogVersion:1}),
   catalogFetch:()=>{throw Object.assign(new Error('TIMEOUT'),{code:'TIMEOUT'});},
   nativeFetchCatalog:async grant=>{
     nativeCalls++;assert.equal(grant.version,3);assert.equal(grant.updatedAt,'fresh');return catalog;
   }
 });
 assert.equal(nativeCalls,0);assert.ok(extractorCalls>=1);
 assert.equal(a.run('displayed.size'),1);
 assert.notEqual(a.run(`displayed.get('${id(1)}').title`),'שם מוכן מהשרת');
 assert.equal(a.calls.filter(x=>x.url.includes('action=list')).length,0);
});
test('missing bundled catalog cannot authorize stale content or cause a second catalog request',async()=>{
 const list='https://www.youtube.com/watch?v='+id(1)+'\n';
 const a=await app(list,()=>json({videoId:id(1),title:'unverified',authorId:A}),new Map(),{
  nativeMode:true,sharedCatalog:{version:3,updatedAt:'fresh',entries:[]},
  nativeFetchAuthorization:async()=>({list,version:3,updatedAt:'fresh',catalogVersion:1}),
  catalogFetch:()=>{throw Object.assign(new Error('TIMEOUT'),{code:'TIMEOUT'})},
  nativeFetchCatalog:async()=>({version:2,updatedAt:'old',entries:[{
    approval_url:'https://www.youtube.com/watch?v='+id(1),kind:'video',item_id:id(1),title:'stale'
  }]})
 });
 assert.equal(a.run('displayed.size'),1,'direct grant remains authoritative');
 assert.ok(a.run('approvalMarker').includes(list));
 assert.notEqual(a.run(`displayed.get('${id(1)}').title`),'stale');
});
test('optional catalog timeout plus metadata network failure preserves only freshly approved manual card',async()=>{
 const list='https://www.youtube.com/watch?v='+id(1)+'\n';
 let nativeCalls=0;
 const a=await app(list,()=>{throw Object.assign(new Error('DNS_ERROR'),{code:'DNS_ERROR'})},new Map(),{
  nativeMode:true,sharedCatalog:{version:3,updatedAt:'fresh',entries:[]},
  nativeFetchAuthorization:async()=>({list,version:3,updatedAt:'fresh',catalogVersion:1}),
  catalogFetch:()=>{throw Object.assign(new Error('TIMEOUT'),{code:'TIMEOUT'})},
  nativeFetchCatalog:async()=>{nativeCalls++;throw Object.assign(new Error('CONNECT_ERROR'),{code:'CONNECT_ERROR'})}
 });
 assert.equal(nativeCalls,0);assert.equal(a.run('displayed.size'),1);
 assert.equal(a.run('approvalMarker').includes(list),true);
 assert.match(a.elements['status-text'].textContent,/חלק מהפרטים/);
});
test('load-start records user pull and scheduled retry triggers independently',async()=>{
 const logs=[],list='https://www.youtube.com/watch?v='+id(1)+'\n';
 const a=await app(list,()=>json({videoId:id(1),title:'מוכן',authorId:A}),new Map(),{
   logCollector:logs,nativeMode:true,
   nativeFetchAuthorization:async()=>({list,version:3,updatedAt:'fresh',catalogVersion:1})
 });
 await a.run("loadApp({forceCatalog:true,trigger:'pull-to-refresh'})");
 const starts=logs.filter(x=>x.startsWith('KidsCatalog load-start'));
 assert.ok(starts.some(x=>x.includes('"trigger":"startup"')));
 assert.ok(starts.some(x=>x.includes('"trigger":"pull-to-refresh"')));
 assert.ok(starts.every(x=>x.includes('"trigger":')));
});

test('native startup uses version-matched catalog embedded in fresh authorization with no second WebView request',async()=>{
 const url='https://www.youtube.com/watch?v='+id(1),list=url+'\n',calls=[];
 const prepared={version:17,updatedAt:'fresh-time',entries:[{approval_url:url,kind:'video',item_id:id(1),title:'מוכן מהאימות',checked_at:new Date().toISOString()}]};
 const a=await app(list,()=>{throw Error('No provider request required');},new Map(),{
   nativeMode:true,
   nativeFetchAuthorization:async()=>({list,version:17,updatedAt:'fresh-time',catalogVersion:1,preparedCatalog:prepared}),
   catalogFetch:()=>{calls.push('WebView');throw Error('Browser catalog must not be fetched');},
   nativeFetchCatalog:async()=>{calls.push('OkHttp');throw Error('Native fallback must not be fetched');}
 });
 assert.equal(a.run('displayed.size'),1);
 assert.equal(a.run(`displayed.get('${id(1)}').title`),'מוכן מהאימות');
 assert.equal(calls.length,0,'one successful native authorization must suffice for first display');
 assert.equal(a.calls.length,0,'no browser network requests');
});
test('bundled old-version catalog is never authorization; metadata failure cannot grant removed video',async()=>{
 const url='https://www.youtube.com/watch?v='+id(1),list=url+'\n';
 const prepared={version:16,updatedAt:'old-time',entries:[{approval_url:url,kind:'video',item_id:id(1),title:'ישן'}]};
 let catalogAttempts=0;
 const a=await app(list,()=>{throw Error('Provider unavailable');},new Map(),{
   nativeMode:true,
   nativeFetchAuthorization:async()=>({list,version:17,updatedAt:'fresh-time',catalogVersion:1,preparedCatalog:prepared}),
   catalogFetch:()=>{catalogAttempts++;return json({version:17,updatedAt:'fresh-time',entries:[]})}
 });
 assert.equal(catalogAttempts,0,'invalid embedded cache cannot cause a second native/browser request');
 assert.equal(a.run('displayed.size'),1,'direct video grant remains visible despite metadata failure');
 assert.notEqual(a.run(`displayed.get('${id(1)}').title`),'ישן');
 const revoked=await app('',()=>{throw Error('provider should not be used')},new Map(),{
   nativeMode:true,
   nativeFetchAuthorization:async()=>({list:'',version:18,updatedAt:'revoked',catalogVersion:1,preparedCatalog:{version:18,updatedAt:'revoked',entries:prepared.entries}}),
   catalogFetch:()=>{throw Error('bundled grants should not fall back')}
 });
 assert.equal(revoked.run('displayed.size'),0);
});
test('slow optional content completion shows spinner only while active and stops on completion',async()=>{
 const list='https://www.youtube.com/channel/'+A+'\n';
 let complete,attempt=0;
 const a=await app(list,url=>{
   if(url.endsWith('/api/v1/channels/'+A))return json({author:'Channel',authorId:A,authorThumbnails:[]});
   attempt++;
   return attempt===1?json({videos:[row(1)],continuation:'next'}):new Promise(resolve=>complete=resolve);
 },new Map(),{timerCap:12});
 assert.equal(a.run('displayed.size'),1);
 a.run('pendingChannelRetry.add('+JSON.stringify(A)+')');
 const pending=a.run('retryCatalogContents()');
 await until(()=>typeof complete==='function');
 await until(()=>a.elements.spinner.hidden===false);
 assert.equal(a.elements.spinner.hidden,false);
 complete(json({videos:[row(1),row(2)],continuation:null}));
 await pending;
 assert.equal(a.elements.spinner.hidden,true);
});
test('failed authorization displays a finite error with explicit retry button and no cached grants',async()=>{
 const raw='https://www.youtube.com/watch?v='+id(1);
 const a=await app(raw,()=>json({videoId:id(1),title:'title'}),new Map(),{
   nativeMode:true,nativeFetchAuthorization:async()=>{throw Object.assign(new Error('TIMEOUT'),{code:'TIMEOUT'})}
 });
 assert.equal(a.run('displayed.size'),0);
 assert.equal(a.elements.spinner.hidden,true);
 assert.equal(a.elements['status-retry'].hidden,false);
 assert.match(a.elements['status-text'].textContent,/לא הצלחנו לאמת/);
});

test('late native poll fails closed after successful startup, then a fresh grant recovers',async()=>{
  const list='https://www.youtube.com/watch?v='+id(1)+'\n',stamp='stable';
  const catalog={version:3,updatedAt:stamp,entries:[{approval_url:'https://www.youtube.com/watch?v='+id(1),
    kind:'video',item_id:id(1),title:'מוכן מראש',checked_at:new Date().toISOString()}]};
  let calls=0;
  const a=await app(list,()=>{throw Error('no provider discovery');},new Map(),{
    nativeMode:true,
    nativeFetchAuthorization:async()=>{
      if(++calls===2)throw Object.assign(new Error('NETWORK_ERROR'),{code:'NETWORK_ERROR'});
      return {list,version:3,updatedAt:stamp,catalogVersion:1,preparedCatalog:catalog};
    },
    listFetch:()=>{throw Error('No independent WebView authorization transport');}
  });
  assert.equal(a.run('displayed.size'),1);
  assert.equal(a.run('approvalMarker')!=='',true);
  await a.run("checkAuthorizationFreshness('poll')");
  assert.equal(a.run('displayed.size'),0,'failed periodic authority must hide every card');
  assert.equal(a.run('approvalMarker'),'','old grant must not remain usable');
  assert.equal(a.run('authorizationRetryAttempts'),1,'recovery is scheduled once with bounded backoff');
  assert.equal(a.elements.spinner.hidden,true,'no endless loading spinner on failure');
  await a.run("loadApp({trigger:'test-recovery'})");
  assert.equal(a.run('displayed.size'),1,'recovery requires another successful fresh grant');
  assert.equal(a.run('authorizationRetryAttempts'),0);
  assert.equal(calls,3,'startup + failed poll + recovery; no hidden extra authority calls');
  assert.equal(a.calls.filter(x=>x.url.includes('action=list')).length,0);
});

test('late successful response from old native poll never restores a revoked or failed-closed grant',async()=>{
  const list='https://www.youtube.com/watch?v='+id(1)+'\n',stamp='stable';
  const grant={list,version:3,updatedAt:stamp,catalogVersion:1,preparedCatalog:{
    version:3,updatedAt:stamp,entries:[{approval_url:'https://www.youtube.com/watch?v='+id(1),
    kind:'video',item_id:id(1),title:'מוכן מראש',checked_at:new Date().toISOString()}]}};
  let resolvePoll,calls=0;
  const a=await app(list,()=>{throw Error('no provider discovery')},new Map(),{
    nativeMode:true,
    nativeFetchAuthorization:async()=>{
      if(++calls===2)return new Promise(resolve=>{resolvePoll=resolve;});
      return grant;
    }
  });
  assert.equal(a.run('displayed.size'),1);
  const oldPoll=a.run("checkAuthorizationFreshness('poll')");
  await until(()=>typeof resolvePoll==='function');
  a.run("failClosedAuthorization('auth verification unavailable','test-fail-closed')");
  assert.equal(a.run('displayed.size'),0);
  resolvePoll(grant);
  await oldPoll;
  assert.equal(a.run('displayed.size'),0);
  assert.equal(a.run('approvalMarker'),'');
  await a.run("loadApp({trigger:'test-fresh-recovery'})");
  assert.equal(a.run('displayed.size'),1);
  assert.equal(calls,3);
});

test('native 409-equivalent NETWORK_ERROR is bounded, fail-closed and recoverable without a load loop',async()=>{
  const list='https://www.youtube.com/watch?v='+id(2)+'\n',stamp='test-rev';
  let calls=0;
  const a=await app(list,()=>json({videoId:id(2),title:'מאושר',authorId:A}),new Map(),{
    nativeMode:true,
    nativeFetchAuthorization:async()=>{
      calls++;
      if(calls===2)throw Object.assign(new Error('NETWORK_ERROR'),{code:'NETWORK_ERROR'});
      return {list,version:3,updatedAt:stamp,catalogVersion:1};
    }
  });
  assert.equal(a.run('displayed.size'),1);
  await a.run("checkAuthorizationFreshness('poll')");
  assert.equal(a.run('displayed.size'),0);
  assert.equal(a.run('authorizationCheckInFlight'),false);
  assert.equal(calls,2,'failure does not cause an immediate unbounded network loop');
  assert.ok(a.run('authorizationRetryAttempts')>=1&&a.run('authorizationRetryAttempts')<=3);
  await a.run("loadApp({trigger:'test-409-recovery'})");
  assert.equal(a.run('displayed.size'),1);
  assert.equal(calls,3);
});

test('app sends the same load-cycle and request trace to native for startup and two periodic checks',async()=>{
  const events=[],traces=[],list='https://www.youtube.com/watch?v='+id(1)+'\n';
  const a=await app(list,()=>{throw Error('native authorization only');},new Map(),{
    nativeMode:true,logCollector:events,
    nativeFetchAuthorization:async trace=>{
      traces.push(trace);
      return {list,version:3,updatedAt:'stable',catalogVersion:1,preparedCatalog:{
        version:3,updatedAt:'stable',entries:[{approval_url:'https://www.youtube.com/watch?v='+id(1),
          kind:'video',item_id:id(1),title:'מוכן',checked_at:new Date().toISOString()}]
      }};
    }
  });
  assert.equal(a.run('displayed.size'),1);
  await a.run("checkAuthorizationFreshness('poll')");
  await a.run("checkAuthorizationFreshness('poll')");
  assert.equal(traces.length,3);
  assert.equal(traces[0].source,'load');
  assert.equal(traces[1].source,'poll');assert.equal(traces[2].source,'poll');
  for(const trace of traces){
    assert.equal(Number.isSafeInteger(trace.loadCycle),true);
    assert.equal(Number.isSafeInteger(trace.requestId),true);
    assert.ok(events.some(line=>line.startsWith('KidsCatalog request-start ') &&
      line.includes('"requestId":'+trace.requestId) &&
      line.includes('"loadCycle":'+trace.loadCycle)));
  }
  assert.equal(new Set(traces.map(t=>t.requestId)).size,3);
});

function controlledTimers(){
  const scheduled=new Map();let current=0,next=0;
  return {
    setTimeout(fn,ms){const id=++next;scheduled.set(id,{fn,at:current+Math.max(0,ms)});return id;},
    clearTimeout(id){scheduled.delete(id);},
    pending(){return [...scheduled.values()].map(t=>t.at-current).sort((a,b)=>a-b);},
    async advance(ms){
      const target=current+ms;
      for(let ticks=0;ticks<100;ticks++){
        const ready=[...scheduled.entries()].filter(([_,t])=>t.at<=target)
          .sort((a,b)=>a[1].at-b[1].at);
        if(!ready.length)break;
        const [id,task]=ready[0];scheduled.delete(id);current=task.at;
        task.fn();
        // Allow actual loadApp and native bridge promises to progress.
        await new Promise(resolve=>setImmediate(resolve));
      }
      current=target;
    }
  };
}
test('real loadApp automatically recovers from four DNS failures and stalled headers on same app state',async()=>{
  const clock=controlledTimers(),events=[];
  const url='https://www.youtube.com/watch?v='+id(1),list=url+'\n',stamp='stable';
  const prepared={version:7,updatedAt:stamp,entries:[
    {approval_url:url,kind:'video',item_id:id(1),title:'מאושר טרי',checked_at:new Date().toISOString()}
  ]};
  let cycles=0,wireAttempts=0,dnsCalls=0,httpArrivals=0;
  const a=await app(list,()=>{throw Error('no NewPipe metadata needed');},new Map(),{
    clock,nativeMode:true,logCollector:events,
    nativeFetchAuthorization:async()=>{
      cycles++;
      if(cycles<=2){
        // A native scoped grant call tries DNS at most twice.
        wireAttempts+=2;dnsCalls+=2;
        throw Object.assign(new Error('DNS_ERROR'),{code:'DNS_ERROR'});
      }
      wireAttempts++;dnsCalls++;httpArrivals++;
      if(cycles===3)throw Object.assign(new Error('TIMEOUT'),{code:'TIMEOUT'});
      return {list,version:7,updatedAt:stamp,catalogVersion:1,preparedCatalog:prepared};
    }
  });
  assert.equal(cycles,1);assert.equal(a.run('displayed.size'),0);
  assert.equal(a.run('approvalMarker'),'');
  assert.deepEqual(clock.pending().filter(ms=>ms>=6000),[6000]);
  for(const delay of [6000,18000,45000]){
    await clock.advance(delay);
    await until(()=>!a.run('loading'));
  }
  assert.equal(cycles,4);
  assert.equal(wireAttempts,6,'4 DNS lookups + timed-out HTTP + successful HTTP');
  assert.equal(dnsCalls,6);assert.equal(httpArrivals,2);
  assert.equal(a.run('displayed.size'),1);
  assert.ok(a.run('approvalMarker').includes(list));
  assert.equal(a.run('authorizationRetryAttempts'),0);
  assert.equal(a.run('catalogRetryAttempts'),0);
  assert.equal(a.elements.spinner.hidden,true);
  assert.deepEqual(clock.pending(),[],'success must actually cancel timers');
  assert.deepEqual(events.filter(x=>x.startsWith('KidsCatalog load-start')).length,4);
  await clock.advance(600000); // No stale auto reload when still in foreground
  assert.equal(cycles,4);
});
test('actual loadApp stops automatic authority retries for permanent errors and valid empty list',async()=>{
  const codes=['AUTH_DENIED','TLS_ERROR','INVALID_AUTH_RESPONSE','REQUEST_ERROR','FORBIDDEN'];
  for(const code of codes){
    const clock=controlledTimers();let count=0;
    const a=await app('',()=>json({videos:[]}),new Map(),{
      clock,nativeMode:true,nativeFetchAuthorization:async()=>{count++;
        throw Object.assign(new Error(code),{code});}
    });
    assert.equal(count,1,code);assert.equal(a.run('displayed.size'),0);
    assert.equal(a.run('approvalMarker'),'');assert.deepEqual(clock.pending(),[],code);
    await clock.advance(600000);assert.equal(count,1,code);
  }
  const clock=controlledTimers();let calls=0;
  const ok=await app('',()=>json({videos:[]}),new Map(),{
    clock,nativeMode:true,nativeFetchAuthorization:async()=>{calls++;
      return {list:'',version:1,updatedAt:'empty-is-valid',catalogVersion:1};}
  });
  assert.equal(calls,1);
  assert.equal(ok.run('authorizationRetryAttempts'),0);
  assert.equal(ok.run('loadError'),false);
  assert.deepEqual(clock.pending(),[]);
});
test('actual authority error handling retries HTTP 409, 429, 5xx and DNS but not 401/403',async()=>{
  for(const code of ['AUTH_CHANGED_RETRY','RATE_LIMITED','NETWORK_ERROR','DNS_ERROR','CONNECT_ERROR','TIMEOUT','PROVIDER_ERROR']){
    const clock=controlledTimers();
    const a=await app('',()=>json({videos:[]}),new Map(),{
      clock,nativeMode:true,nativeFetchAuthorization:async()=>{throw Object.assign(new Error(code),{code});}
    });
    assert.equal(a.run('authorizationRetryAttempts'),1,code);
    assert.deepEqual(clock.pending().filter(ms=>ms>=6000),[6000],code);
  }
});

test('optional partial HTTP 200 superseded by newer playback grant is not a network outage',async()=>{
  const logs=[],url='https://www.youtube.com/watch?v='+id(1),list=url+'\n',stamp='stable';
  const prepared={version:4,updatedAt:stamp,entries:[{
    approval_url:url,kind:'video',item_id:id(1),title:'מוכן מראש',checked_at:new Date().toISOString()
  }]};
  let rejectPartial,requests=0;
  const grant={list,version:4,updatedAt:stamp,catalogVersion:1,preparedCatalog:prepared};
  const a=await app(list,()=>{throw Error('no optional provider request');},new Map(),{
    nativeMode:true,logCollector:logs,
    nativeFetchAuthorization:async trace=>{
      requests++;
      if(trace?.source==='partial-retry')
        return new Promise((_,reject)=>{rejectPartial=reject;});
      return grant;
    }
  });
  assert.equal(a.run('displayed.size'),1);
  const marker=a.run('approvalMarker');
  // Artificial outstanding optional channel work. The failed optional
  // authorization must not start the work or replace the approved catalog.
  a.run('pendingChannelRetry.add('+JSON.stringify(A)+')');
  const oldPartial=a.run('retryCatalogContents()');
  await until(()=>typeof rejectPartial==='function');
  const newerGrant=await a.context.KidsNative.fetchAuthorization({loadCycle:2,requestId:12,source:'playback'});
  assert.equal(newerGrant.version,4,'newer fresh grant is accepted first');
  rejectPartial(Object.assign(new Error('AUTH_SUPERSEDED'),{code:'AUTH_SUPERSEDED'}));
  await oldPartial;
  assert.equal(requests,3,'startup, old optional request, fresh playback grant');
  assert.equal(a.run('displayed.size'),1);
  assert.equal(a.run('approvalMarker'),marker);
  assert.equal(a.run('authorizationRetryAttempts'),0);
  assert.equal(a.run('catalogRetryAttempts'),0);
  assert.equal(a.run('catalogRetryPending'),true,'optional work is deferred, not restarted');
  assert.equal(a.elements.spinner.hidden,true);
  assert.match(a.elements['status-text'].textContent,/הושהתה/);
  assert.ok(logs.some(line=>line.includes('partial-retry-superseded')));
  assert.equal(logs.some(line=>line.includes('partial-retry-auth-failed')&&line.includes('NETWORK_ERROR')),false);
});
test('superseded startup cannot accept old content but schedules one fresh reconciliation',async()=>{
  const list='https://www.youtube.com/watch?v='+id(1)+'\n';
  const a=await app(list,()=>{throw Error('unexpected provider');},new Map(),{
    nativeMode:true,nativeFetchAuthorization:async()=>{
      throw Object.assign(new Error('AUTH_SUPERSEDED'),{code:'AUTH_SUPERSEDED'});
    }
  });
  assert.equal(a.run('displayed.size'),0);
  assert.equal(a.run('approvalMarker'),'');
  assert.equal(a.run('authorizationRetryAttempts'),1);
  assert.equal(a.elements.spinner.hidden,true);
  assert.match(a.elements['status-text'].textContent,/אימות קודם/);
});

test('native player pauses only background grant checks, then resumes a fresh check on close',async()=>{
  const list='https://www.youtube.com/watch?v='+id(1)+'\n',stamp='stable';
  const catalog={version:8,updatedAt:stamp,entries:[
    {approval_url:'https://www.youtube.com/watch?v='+id(1),kind:'video',
      item_id:id(1),title:'Approved card',checked_at:new Date().toISOString()}
  ]};
  let checks=0;
  const a=await app(list,()=>{throw Error('no provider metadata needed');},new Map(),{
    nativeMode:true,nativeFetchAuthorization:async()=>{checks++;
      return {list,version:8,updatedAt:stamp,catalogVersion:1,preparedCatalog:catalog};}
  });
  assert.equal(checks,1);assert.equal(a.run('displayed.size'),1);
  for(const fn of a.listeners['kids-native-playback-open'])fn();
  assert.equal(a.run('nativePlaybackActive'),true);
  await a.run("checkAuthorizationFreshness('poll')");
  assert.equal(checks,1,'hidden WebView is not document.hidden; still avoid native poll');
  for(const fn of a.listeners['kids-native-playback-closed'])fn();
  await until(()=>checks===2);
  await until(()=>a.run('authorizationCheckInFlight')===false);
  assert.equal(a.run('nativePlaybackActive'),false);
  assert.equal(a.run('displayed.size'),1);
  assert.notEqual(a.run('approvalMarker'),'');
});
test('in-flight background grant cancelled for native play cannot hide usable catalog',async()=>{
  const list='https://www.youtube.com/watch?v='+id(1)+'\n',stamp='stable';
  let calls=0,failPoll;
  const catalog={version:8,updatedAt:stamp,entries:[{
    approval_url:'https://www.youtube.com/watch?v='+id(1),kind:'video',
    item_id:id(1),title:'Approved',checked_at:new Date().toISOString()}]};
  const a=await app(list,()=>{throw Error('no provider');},new Map(),{
    nativeMode:true,nativeFetchAuthorization:async()=>{
      calls++;
      if(calls===2)return new Promise((_,reject)=>failPoll=reject);
      return {list,version:8,updatedAt:stamp,catalogVersion:1,preparedCatalog:catalog};
    }
  });
  const pending=a.run("checkAuthorizationFreshness('poll')");
  await until(()=>typeof failPoll==='function');
  for(const fn of a.listeners['kids-native-playback-open'])fn();
  failPoll(Object.assign(new Error('PLAYBACK_BUSY'),{code:'PLAYBACK_BUSY'}));
  await pending;
  assert.equal(a.run('displayed.size'),1);
  assert.equal(a.run('authorizationRetryAttempts'),0);
  for(const fn of a.listeners['kids-native-playback-closed'])fn();
  await until(()=>calls===3);
  assert.equal(a.run('displayed.size'),1,'fresh grants unchanged, no blank catalog');
});
