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
  const document={head:new Element('head'),body:new Element('body'),activeElement:null,hidden:false,addEventListener(){},
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
    fetch:async(url,opts)=>{calls.push({url:String(url),opts});if(String(url)==='./videos.txt')return options.offline?fail():json(config);return api(String(url),opts);},
    addEventListener:(k,fn)=>(listeners[k]??=[]).push(fn),removeEventListener:(k,fn)=>listeners[k]=(listeners[k]||[]).filter(f=>f!==fn)});
  context.window=context;
  if(options.storageAccessDenied)Object.defineProperty(context,'localStorage',{get(){throw new Error('SecurityError: storage access denied');}});
  vm.runInContext(scripts[0],context,{filename:'service-worker-registration.js'});
  vm.runInContext(providerScript,context,{filename:'providers.js'});
  vm.runInContext(scripts[1],context,{filename:'index-inline.js'});
  await until(()=>!vm.runInContext('loading',context));
  return {context,elements,calls,store,document,listeners,run:code=>vm.runInContext(code,context)};
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
test('offline whitelist falls back to last-known approved snapshot',async()=>{
  const store=new Map();await app({videos:[{id:id(1)}],channels:[]},undefined,store);
  const a=await app(empty,fail,store,{offline:true});
  assert.equal(a.run('displayed.size'),1);assert.match(a.elements['status-text'].textContent,/הרשימה השמורה/);
});
test('empty offline fallback shows the requested friendly error',async()=>{
  const a=await app(empty,fail,new Map(),{offline:true});
  assert.equal(a.run('displayed.size'),0);assert.match(a.elements['status-text'].textContent,/הסרטונים אינם זמינים כרגע. נסו שוב מאוחר יותר./);
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
test('disabled localStorage still allows manual playback and more cards',async()=>{
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
function media(a) { return a.elements['media-host'].children[0]; }
function emit(element,event) { for(const fn of element.listeners[event] || [])fn(); }
test('player enforces approved IDs, native media, no iframe navigation, and stops before hide',async()=>{
  const a=await app({videos:[{id:id(1),title:'סרטון שלנו'}],channels:[]});
  a.run(`openPlayer('${id(9)}')`);assert.equal(a.elements.player.hidden,true);
  a.run(`openPlayer('${id(1)}')`);await until(()=>!!media(a)?.src);
  const video=media(a),url=new URL(video.src);
  assert.equal(url.pathname,'/latest_version');assert.equal(url.searchParams.get('id'),id(1));assert.equal(url.searchParams.get('local'),'true');assert.equal(url.searchParams.get('itag'),'18');
  assert.equal(a.elements.app.inert,true);emit(video,'canplay');assert.equal(a.elements['player-message'].textContent,'');
  a.run('closePlayer()');assert.equal(video.src,'');assert.equal(video.paused,true);assert.equal(a.elements.player.hidden,true);assert.equal(a.elements.app.inert,false);
  assert.doesNotMatch(html,/allowfullscreen|sandbox="allow-scripts allow-same-origin/);
});
test('actual media and embed errors automatically advance to the next instance',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]});
  a.run(`openPlayer('${id(1)}')`);await until(()=>!!media(a)?.src);const first=media(a);emit(first,'error');await until(()=>media(a)!==first);
  const frame=media(a);assert.equal(frame.tagName,'iframe');emit(frame,'error');await until(()=>media(a)!==frame);
  assert.match(media(a).src,/tiekoetter/);emit(first,'canplay');assert.match(media(a).src,/tiekoetter/);a.run('closePlayer()');
});
test('all finite player attempts failing show a friendly retry state',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]});a.run(`openPlayer('${id(1)}')`);await until(()=>!!media(a));
  for(let i=0;i<6;i++){const v=media(a);assert.ok(v);emit(v,'error');await new Promise(r=>setTimeout(r,0));}
  await until(()=>!a.elements['player-error'].hidden);assert.equal(media(a),undefined);assert.equal(a.elements['player-message'].textContent,'');assert.equal(a.elements['player-error'].getAttribute('role'),'alert');a.run('closePlayer()');
});
test('closing cancels an in-progress native source and ignores its late events',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]});a.run(`openPlayer('${id(1)}')`);await until(()=>!!media(a));const v=media(a);
  a.run('closePlayer()');emit(v,'canplay');emit(v,'error');assert.equal(media(a),undefined);assert.equal(a.elements.player.hidden,true);
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
  let work;handlers.install({waitUntil:p=>work=p});await work;assert.equal(skip,1);assert.equal(cached.size,8);
  handlers.activate({waitUntil:p=>work=p});await work;assert.equal(claim,1);assert.equal(deleted.length,1);assert.match(deleted[0],/old$/);
  for(const url of [scope+'videos.txt','https://invidious.example/api/v1/videos/abc']){
    let intercepted=false;handlers.fetch({request:{url,method:'GET',mode:'cors'},respondWith:()=>intercepted=true});assert.equal(intercepted,false);
  }
  let response;handlers.fetch({request:{url:scope,method:'GET',mode:'navigate'},respondWith:p=>response=p});assert.ok(await response);
});
test('tablet grid, tap targets and reduced-motion styles are provided',()=>{
  assert.match(html,/minmax\(min\(100%,260px\),1fr\)/);assert.match(html,/min-width:700px/);
  assert.match(html,/min-height:58px/);assert.match(html,/prefers-reduced-motion:reduce/);
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
  assert.equal(a.run('displayed.size'),2);assert.equal(a.calls[0].url,'./videos.txt');assert.equal(a.calls[0].opts.cache,'no-store');
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
  const b=await app('',fail,store,{offline:true});assert.equal(b.run('displayed.size'),1);
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
  assert.match(a.elements['search-label'].textContent,/ערוץ/);
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
  await inputSearch(a,'לא קיים');assert.equal(a.elements.empty.hidden,false);assert.match(a.elements['empty-title'].textContent,/לא מצאנו/);
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
test('closing the player preserves channel, search, more-card limit and scroll',async()=>{
  const a=await app({videos:[],channels:[{id:A,name:'מאיר'}]},url=>url.includes('/channels/')?metadataApi(url):json({videoId:id(2)}));
  a.run(`switchBrowse('channels','${A}')`);await inputSearch(a,'2');a.run('visibleCount=120; window.scrollY=500');
  const card=a.elements.grid.children[0];card.focus();clickGrid(a,card);
  await until(()=>!!media(a));emit(media(a),'canplay');a.run('window.scrollY=0; closePlayer(true)');
  assert.equal(media(a),undefined);assert.equal(a.elements.player.hidden,true);
  assert.equal(a.run('selectedChannelId'),A);assert.equal(a.elements.search.value,'2');assert.equal(a.run('visibleCount'),120);
  assert.equal(a.run('window.scrollY'),500);assert.equal(a.document.activeElement,card);
});
test('background render during playback restores focus to the replacement card',async()=>{
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
test('navigation stays visible and search controls have large tablet touch targets',()=>{
  assert.match(html,/\.browse-controls \{ position:sticky/);assert.match(html,/\.tab \{[^}]*min-height:78px/);
  assert.match(html,/<label[^>]*for="search"/);assert.match(html,/id="search" type="search"/);
  assert.match(html,/id="back-channels"/);assert.doesNotMatch(html,/api\/v1\/search/);
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
test('rapid opens cannot let an old media callback replace the latest video',async()=>{
  const a=await app({videos:[{id:id(1)},{id:id(2)}],channels:[]});a.run(`openPlayer('${id(1)}')`);await until(()=>!!media(a));const old=media(a);
  a.run(`openPlayer('${id(2)}')`);await until(()=>!!media(a)?.src && new URL(media(a).src).searchParams.get('id')===id(2));emit(old,'error');emit(old,'canplay');
  assert.equal(new URL(media(a).src).searchParams.get('id'),id(2));assert.equal(old.src,'');a.run('closePlayer()');
});
test('cached forged channel membership cannot authorize playback',async()=>{
  const store=new Map(),config={videos:[],channels:[{id:A}]};await app(config,()=>json({videos:[row(1)],continuation:null}),store);
  const snapshot=JSON.parse(store.get('kidsYoutubeVideos'));snapshot.channelLists[A]=[{id:id(9),channelId:A,title:'forged'}];store.set('kidsYoutubeVideos',JSON.stringify(snapshot));
  for(const key of [...store.keys()])if(key.startsWith('kidsYoutubeData:'))store.delete(key);
  const a=await app(config,url=>url.includes('/api/v1/videos/')?json({videoId:id(9),title:'belongs elsewhere',authorId:B}):fail(),store);
  a.run(`openPlayer('${id(9)}')`);await until(()=>!a.elements['player-error'].hidden);assert.equal(media(a),undefined);a.run('closePlayer()');
});
test('authorization metadata cancellation stops a late response after switching videos',async()=>{
  const a=await app({videos:[{id:id(2)}],channels:[]});
  a.run(`render(normalizeConfig({videos:[{id:'${id(2)}'}],channels:[{id:'${A}'}]}),{'${A}':[{id:'${id(1)}',channelId:'${A}'}]})`);
  a.run(`openPlayer('${id(1)}');openPlayer('${id(2)}')`);await until(()=>!!media(a));assert.equal(new URL(media(a).src).searchParams.get('id'),id(2));a.run('closePlayer()');
});
test('autoplay rejection asks for one tap and does not fail over unnecessarily',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]});a.run(`openPlayer('${id(1)}')`);await until(()=>!!media(a));const v=media(a);
  v.play=()=>Promise.reject(Object.assign(new Error(),{name:'NotAllowedError'}));emit(v,'canplay');await new Promise(r=>setTimeout(r,0));
  assert.equal(media(a),v);assert.match(a.elements['player-message'].textContent,/לחצו/);a.run('closePlayer()');
});
test('media timeout automatically advances and has a finite total attempt budget',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]},undefined,new Map(),{timerCap:8});a.run(`openPlayer('${id(1)}')`);await until(()=>!!media(a));const first=media(a);
  await until(()=>media(a)!==first);assert.ok(a.run('providers.snapshot().requests.some(r=>r.kind==="playback" && r.outcome==="TIMEOUT")'));
  await until(()=>!a.elements['player-error'].hidden);assert.equal(a.run('playback.index'),3);a.run('closePlayer()');
});
test('re-rendering keeps existing thumbnail nodes rather than issuing duplicate loads',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]});const image=a.elements.grid.children[0].children[0].children[0];a.run('render(activeConfig,activeLists)');assert.equal(a.elements.grid.children[0].children[0].children[0],image);assert.equal(image.loading,'lazy');
});
test('online recovery resets cooldown and refreshes whitelist',async()=>{
  const a=await app();const initial=a.calls.length;a.listeners.offline[0]();assert.match(a.elements['status-text'].textContent,/אין חיבור/);a.listeners.online[0]();await until(()=>!a.run('loading'));assert.equal(a.calls.length,initial+1);
});
test('clear-cache control evicts API data while preserving parent whitelist source',async()=>{
  const a=await app(link(1),metadataApi);assert.ok(a.run('providers.snapshot().cacheEntries')>0);a.elements['clear-cache'].listeners.click[0]();await until(()=>!a.run('loading'));assert.equal(a.run('displayed.size'),1);assert.equal(a.calls.filter(c=>c.url==='./videos.txt').length,2);
});
test('search debounce collapses rapid input and preserves pending input on background render',async()=>{
  const a=await app({videos:[{id:id(1),title:'שיר'}],channels:[]});
  a.elements.search.value='ש';a.elements.search.listeners.input[0]();a.elements.search.value='שיר';a.elements.search.listeners.input[0]();a.run('render(activeConfig,activeLists)');assert.equal(a.elements.search.value,'שיר');
  await until(()=>a.run('searchTimer')===null);assert.deepEqual(visibleVideoIds(a),[id(1)]);
});

test('native failure automatically opens the validated compatibility embed with restricted cross-origin sandbox',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]},()=>json({videoId:id(1),title:'שם הסרטון'}));
  a.run(`openPlayer('${id(1)}')`);await until(()=>!!media(a));const old=media(a);emit(old,'error');await until(()=>media(a)?.tagName==='iframe');const frame=media(a);
  const url=new URL(frame.src);assert.equal(url.pathname,'/kids-youtube/player.html');
  assert.equal(frame.getAttribute('sandbox'),null);assert.equal(frame.getAttribute('allow'),'autoplay; fullscreen; picture-in-picture');assert.equal(frame.getAttribute('allowfullscreen'),null);
  emit(frame,'load');assert.equal(frame.sentMessages[0].message.videoId,id(1));a.listeners.message[0]({source:frame.contentWindow,origin:'https://example.test',data:{type:'kids-player-ready',videoId:id(1)}});assert.equal(a.run('providers.snapshot().requests.at(-1).outcome'),'loaded-not-playback-proof');
  a.run('closePlayer()');assert.equal(frame.src,'');assert.equal(a.elements.player.hidden,true);
});
test('direct approval keeps the exact embed ID without depending on unrelated metadata',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]},()=>json({videoId:id(2),title:'wrong'}));a.run(`openPlayer('${id(1)}')`);await until(()=>!!media(a));emit(media(a),'error');await until(()=>media(a)?.tagName==='iframe');
  emit(media(a),'load');assert.equal(media(a).sentMessages[0].message.videoId,id(1));assert.equal(a.calls.length,1);a.run('closePlayer()');
});

test('metadata updates reuse thumbnail nodes while updating literal title and author text',async()=>{
  const a=await app({videos:[{id:id(1),title:'ישן'}],channels:[]});const image=a.elements.grid.children[0].children[0].children[0];
  a.run(`render(normalizeConfig({videos:[{id:'${id(1)}',title:'חדש',author:'<img onerror=x>',published:123}],channels:[]}),{})`);
  const card=a.elements.grid.children[0];assert.equal(card.children[0].children[0],image);assert.equal(card.children[1].textContent,'חדש');assert.equal(card.children[2].textContent,'<img onerror=x>');
});

test('compatibility iframe URL and deadline exist before the first load event',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]},()=>json({videoId:id(1),title:'מאושר'}));a.run(`openPlayer('${id(1)}')`);await until(()=>!!media(a));emit(media(a),'error');await until(()=>media(a)?.tagName==='iframe');
  assert.match(media(a).src,/\/player\.html/);assert.ok(a.run('playerTimer'));assert.equal(a.run('providers.snapshot().requests.some(r=>r.kind==="embed")'),false);
  emit(media(a),'load');a.listeners.message[0]({source:media(a).contentWindow,origin:'https://example.test',data:{type:'kids-player-ready',videoId:id(1)}});assert.ok(a.run('providers.snapshot().requests.some(r=>r.kind==="embed")'));a.run('closePlayer()');
});

test('parent frame CSP permits only its trusted local bridge',async()=>{
  const a=await app();const meta=a.document.head.children[0];assert.equal(meta.httpEquiv,'Content-Security-Policy');
  assert.match(meta.content,/frame-src 'self'/);assert.match(meta.content,/object-src 'none'/);assert.doesNotMatch(meta.content,/example\.test|\*|data:|blob:/);
});

test('compatibility status messages reject forged senders and detach on close',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]},()=>json({videoId:id(1),title:'מאושר'}));
  a.run(`openPlayer('${id(1)}')`);await until(()=>!!media(a));emit(media(a),'error');await until(()=>media(a)?.tagName==='iframe');
  const frame=media(a),handler=a.listeners.message[0],payload={type:'kids-player-ready',videoId:id(1)};
  handler({source:{},origin:'https://example.test',data:payload});
  handler({source:frame.contentWindow,origin:'https://attacker.test',data:payload});
  handler({source:frame.contentWindow,origin:'https://example.test',data:{...payload,videoId:id(2)}});
  assert.equal(a.run('providers.snapshot().requests.some(r=>r.kind==="embed")'),false);assert.ok(a.run('playerTimer'));
  a.run('closePlayer()');assert.equal(a.listeners.message.length,0);
  handler({source:frame.contentWindow,origin:'https://example.test',data:payload});
  assert.equal(a.run('providers.snapshot().requests.some(r=>r.kind==="embed")'),false);assert.equal(a.elements.player.hidden,true);
});

test('expired compatibility budget terminates in friendly error rather than a stuck loading state',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]});a.run(`openPlayer('${id(1)}')`);await until(()=>!!media(a));
  await a.run('playback.deadline=Date.now()-1;tryCompatiblePlayer(playback,INVIDIOUS_INSTANCES[0],playerSequence)');assert.equal(a.elements['player-error'].hidden,false);assert.equal(media(a),undefined);a.run('closePlayer()');
});

test('global channel filter does not hide manual approvals or block pagination inside another channel',async()=>{
  const a=await app({videos:[{id:id(9),title:'ידני'}],channels:[{id:A},{id:B}]},url=>{
    const channel=url.includes(A)?A:B;return json({videos:[row(new URL(url).searchParams.has('continuation')?3:channel===A?1:2,channel)],continuation:new URL(url).searchParams.has('continuation')?null:'next'});
  });
  a.run(`channelFilter='${A}';switchBrowse('videos')`);assert.deepEqual(visibleVideoIds(a),[id(9)]);
  a.run(`switchBrowse('channels','${B}')`);assert.equal(a.elements['channel-filter'].value,B);assert.equal(a.elements.more.hidden,false);
  const before=a.calls.length;await a.run('loadMoreVideos()');assert.equal(a.calls.length,before+1);assert.deepEqual(visibleVideoIds(a),[id(2),id(3)]);
});

test('direct approved embed remains reachable after API 401, 403, 500 or network/CORS failure',async()=>{
  for(const status of [401,403,500,'network']){
    const a=await app(link(1),()=>{if(status==='network')throw new TypeError('Failed to fetch');return {ok:false,status};});
    const initialCalls=a.calls.length;assert.ok(initialCalls>1);
    a.run(`openPlayer('${id(1)}')`);await until(()=>!!media(a));emit(media(a),'error');await until(()=>media(a)?.tagName==='iframe');
    emit(media(a),'load');assert.equal(media(a).sentMessages[0].message.videoId,id(1));assert.equal(a.calls.length,initialCalls);a.run('closePlayer()');
  }
});
test('fresh approved channel rows do not need a second metadata request for compatibility',async()=>{
  const a=await app({videos:[],channels:[{id:A}]},()=>json({videos:[row(1)],continuation:null}));const initialCalls=a.calls.length;
  a.run(`openPlayer('${id(1)}')`);await until(()=>!!media(a));emit(media(a),'error');await until(()=>media(a)?.tagName==='iframe');
  assert.equal(a.calls.length,initialCalls);a.run('closePlayer()');
});
test('cached-only channel approval still requires fresh membership when every API is unavailable',async()=>{
  const store=new Map(),config={videos:[],channels:[{id:A}]};await app(config,()=>json({videos:[row(1)],continuation:null}),store);
  for(const key of [...store.keys()])if(key.startsWith('kidsYoutubeData:'))store.delete(key);
  const a=await app(config,fail,store);assert.equal(a.run('displayed.size'),1);
  a.run(`openPlayer('${id(1)}')`);await until(()=>!a.elements['player-error'].hidden);assert.equal(media(a),undefined);a.run('closePlayer()');
});
test('retry explicitly resets both transports and authorization failures for one bounded round',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]});
  a.run(`for(const base of INVIDIOUS_INSTANCES){providers.markResourceFailure(base,'/native/${id(1)}');providers.markResourceFailure(base,'/embed/${id(1)}');providers.markResourceFailure(base,'/api/v1/videos/${id(1)}');providers.setCachedData('compatibility:'+base+'${id(1)}',{preferred:true},60000);providers.updateProviderHealth(base,'native',false,1,new KidsProviders.AppError('TIMEOUT'));providers.updateProviderHealth(base,'playback',false,1,new KidsProviders.AppError('TIMEOUT'));}`);
  a.run(`openPlayer('${id(1)}')`);await until(()=>!a.elements['player-error'].hidden);a.elements['retry-video'].listeners.click[0]();await until(()=>media(a)?.tagName==='video');
  assert.equal(a.run(`providers.getHealthyProviders('api','/api/v1/videos/${id(1)}').length`),3);assert.equal(a.run(`providers.getHealthyProviders('native','/native/${id(1)}').length`),3);
  assert.equal(a.run(`INVIDIOUS_INSTANCES.some(base=>providers.getCachedData('compatibility:'+base+'${id(1)}'))`),false);assert.equal(a.run('playback.index'),1);a.run('closePlayer()');
});
test('failed compatibility resource is skipped for the same video without disabling other videos',async()=>{
  const a=await app({videos:[{id:id(1)},{id:id(2)}],channels:[]});a.run(`openPlayer('${id(1)}')`);await until(()=>!!media(a));emit(media(a),'error');await until(()=>media(a)?.tagName==='iframe');emit(media(a),'error');a.run('closePlayer()');
  a.run(`openPlayer('${id(1)}')`);await until(()=>media(a)?.tagName==='video');assert.match(media(a).src,/tiekoetter/);a.run('closePlayer()');
  a.run(`openPlayer('${id(2)}')`);await until(()=>media(a)?.tagName==='video');assert.match(media(a).src,/f5/);a.run('closePlayer()');
});
test('blocked localStorage property getter cannot prevent startup or approved playback',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]},undefined,new Map(),{storageAccessDenied:true});assert.equal(a.run('displayed.size'),1);
  a.run(`openPlayer('${id(1)}')`);await until(()=>media(a)?.tagName==='video');a.run('closePlayer()');
});

test('revoking an approval during playback prevents the next fallback source',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]});a.run(`openPlayer('${id(1)}')`);await until(()=>!!media(a));emit(media(a),'error');await until(()=>media(a)?.tagName==='iframe');
  a.run('activeConfig=normalizeConfig({videos:[],channels:[]})');emit(media(a),'error');await until(()=>!a.elements['player-error'].hidden);assert.equal(media(a),undefined);assert.equal(a.run('playback.index'),1);a.run('closePlayer()');
});

test('asking for another player evicts sticky compatibility and skips failed source on reopening',async()=>{
  const a=await app({videos:[{id:id(1)},{id:id(2)}],channels:[]});a.run(`openPlayer('${id(1)}')`);await until(()=>media(a)?.tagName==='video');
  a.run(`providers.setCachedData('compatibility:'+INVIDIOUS_INSTANCES[0]+'${id(1)}',{preferred:true},60000)`);
  a.elements['next-player'].listeners.click[0]();await until(()=>media(a)?.src?.includes('tiekoetter'));
  assert.equal(a.run(`providers.getCachedData('compatibility:'+INVIDIOUS_INSTANCES[0]+'${id(1)}')`),null);a.run('closePlayer()');
  a.run(`openPlayer('${id(1)}')`);await until(()=>!!media(a));assert.match(media(a).src,/tiekoetter/);a.run('closePlayer()');
  a.run(`openPlayer('${id(2)}')`);await until(()=>!!media(a));assert.match(media(a).src,/f5/);a.run('closePlayer()');
});
test('parent diagnostic pause excludes that source from playback and explicit retry',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]},undefined,new Map(),{href:'https://example.test/kids-youtube/?diagnostics=1'});
  const button=a.elements['provider-controls'].children[0].children[1];button.listeners.click[0]();assert.match(button.textContent,/הפעלת מקור 1 מחדש/);
  a.run(`openPlayer('${id(1)}')`);await until(()=>!!media(a));assert.match(media(a).src,/tiekoetter/);
  a.elements['retry-video'].listeners.click[0]();await until(()=>!!media(a));assert.match(media(a).src,/tiekoetter/);a.run('closePlayer()');
});

test('last embed offers a child-friendly failure action and ends without repeating providers',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]});a.run('providers.pauseProvider(INVIDIOUS_INSTANCES[0]);providers.pauseProvider(INVIDIOUS_INSTANCES[1]);');
  a.run(`openPlayer('${id(1)}')`);await until(()=>media(a)?.tagName==='video');emit(media(a),'error');await until(()=>media(a)?.tagName==='iframe');
  const frame=media(a);a.listeners.message[0]({source:frame.contentWindow,origin:'https://example.test',data:{type:'kids-player-ready',videoId:id(1)}});
  assert.equal(a.elements['next-player'].hidden,false);assert.equal(a.elements['next-player'].textContent,'הסרטון לא מתחיל');
  a.elements['next-player'].listeners.click[0]();await until(()=>!a.elements['player-error'].hidden);assert.equal(media(a),undefined);assert.equal(a.run('playback.index'),1);a.run('closePlayer()');
});
