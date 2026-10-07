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
const json = data => ({ok:true,json:async()=>data,text:async()=>typeof data === 'string' ? data : JSON.stringify(data)});
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
  const document={head:new Element('head'),body:new Element('body'),activeElement:null,hidden:false,addEventListener:(k,fn)=>(docListeners[k]??=[]).push(fn),
    getElementById:id=>elements[id],createElement:tag=>{const el=new Element(tag);el.doc=document;return el;},
    createDocumentFragment:()=>new Element('fragment',true)};
  for(const m of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const el=new Element(m[1]);el.doc=document;el.hidden=/\bhidden\b/.test(m[2]);
    for(const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g))el.attributes[a[1]]=a[2];
    elements[m[3]]=el;
  }
  const listeners={};
  const history={state:null,pushState(state){this.state=state;},replaceState(state){this.state=state;},back(){this.state=null;}};
  const context=vm.createContext({URL,AbortController,setTimeout:options.timerCap ? ((fn,ms)=>setTimeout(fn,Math.min(ms,options.timerCap))) : setTimeout,clearTimeout,Date,Map,Set,Promise,console,history,
    navigator:{},scrollY:0,scrollTo(position){this.scrollY=position.top;},location:{href:options.href||'https://example.test/kids-youtube/'},document,
    localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>{if(options.noStorage)throw new Error('quota');store.set(k,v);}},
    fetch:async(url,opts)=>{calls.push({url:String(url),opts});const target=String(url);const raw=typeof config==='string'?config:JSON.stringify(config);if(target.includes('/functions/v1/kids-youtube?action=list'))return options.offline?fail():json({list:raw});if(target==='./videos.txt')return options.offline?fail():json(config);return api(target,opts);},
    addEventListener:(k,fn)=>(listeners[k]??=[]).push(fn),removeEventListener:(k,fn)=>listeners[k]=(listeners[k]||[]).filter(f=>f!==fn)});
  context.window=context;context.parent=options.parentWindow||context;
  if(options.storageAccessDenied)Object.defineProperty(context,'localStorage',{get(){throw new Error('SecurityError: storage access denied');}});
  vm.runInContext(scripts[0],context,{filename:'service-worker-registration.js'});
  vm.runInContext(providerScript,context,{filename:'providers.js'});
  vm.runInContext(scripts[1],context,{filename:'index-inline.js'});
  await until(()=>!vm.runInContext('loading',context));
  return {context,elements,calls,store,document,listeners,docListeners,run:code=>vm.runInContext(code,context)};
}
const plain = obj => JSON.parse(JSON.stringify(obj));

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
  assert.equal(a.run('displayed.size'),2);assert.match(a.elements['status-text'].textContent,/השמורים/);
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
  assert.equal(a.elements['empty-clear'].dataset.action,'retry');assert.equal(a.elements['empty-clear'].textContent,'נסה שוב');
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
  const a=await app({videos:[],channels:[{id:A}]},()=>json({videos:[],continuation:null}),store);assert.equal(a.run('displayed.size'),0);
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
  assert.equal(a.elements.grid.children[0].children[2].textContent,'יוצר הסרטון');
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
test('cached alias, video title and channel videos survive all instance failures',async()=>{
  const store=new Map(),list=link(1)+'\nhttps://youtube.com/@Example';
  await app(list,metadataApi,store);
  const a=await app(list,fail,store);
  assert.equal(a.run('displayed.size'),2);assert.equal(a.run('activeConfig.channels[0].name'),'שם הערוץ האוטומטי');
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
  assert.deepEqual(visibleVideoIds(a),[id(1),id(3),id(4),id(2)]);
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
test('pulling down at the top refreshes the authoritative list',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]});const before=a.calls.filter(c=>c.url.includes('/functions/v1/kids-youtube?action=list')).length;
  const target=a.elements.grid;
  a.docListeners.touchstart[0]({touches:[{clientY:10}],target});
  a.docListeners.touchmove[0]({touches:[{clientY:90}],target});
  a.docListeners.touchend[0]({});
  await until(()=>!a.run('loading'));
  assert.equal(a.calls.filter(c=>c.url.includes('/functions/v1/kids-youtube?action=list')).length,before+1);
});
test('parent catalog sends an approved video to its authenticated host instead of the app deep link',async()=>{
  const sent=[],parentWindow={postMessage:(message,origin)=>sent.push({message,origin})};
  const a=await app({videos:[{id:id(1),title:'מאושר'}],channels:[]},undefined,new Map(),{href:'https://example.test/kids-youtube/?parentCatalog=1',parentWindow});
  a.run(`openPlayer('${id(1)}')`);
  assert.equal(sent.length,1);assert.equal(sent[0].message.id,id(1));assert.equal(sent[0].origin,'https://example.test');
  assert.equal(a.elements.player.hidden,true);
});

test('re-rendering keeps existing thumbnail nodes rather than issuing duplicate loads',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]});const image=a.elements.grid.children[0].children[0].children[0];a.run('render(activeConfig,activeLists)');assert.equal(a.elements.grid.children[0].children[0].children[0],image);assert.equal(image.loading,'lazy');
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

