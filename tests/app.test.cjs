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
  constructor(tag='div',fragment=false) { this.tagName=tag;this.fragment=fragment;this.hidden=false;this.children=[];this.attributes={};this.dataset={};this.style={};this.listeners={};this.isConnected=true; }
  append(...nodes) { this.children.push(...nodes.flatMap(n=>n.fragment?n.children:[n])); }
  replaceChildren(...nodes) { this.children=[];this.append(...nodes); }
  setAttribute(k,v) { this.attributes[k]=String(v); }
  removeAttribute(k) { delete this.attributes[k]; }
  getAttribute(k) { return this.attributes[k]??null; }
  addEventListener(k,fn) { (this.listeners[k]??=[]).push(fn); }
  blur() { this.doc.activeElement=null; }
  focus() { this.doc.activeElement=this; }
  contains(el) { return this.children.includes(el); }
  querySelectorAll() { return this.children; }
}
async function app(config=empty,api=()=>json({videos:[],continuation:null}),store=new Map(),options={}) {
  const elements={};const calls=[];
  const document={body:new Element('body'),activeElement:null,hidden:false,addEventListener(){},
    getElementById:id=>elements[id],createElement:tag=>{const el=new Element(tag);el.doc=document;return el;},
    createDocumentFragment:()=>new Element('fragment',true)};
  for(const m of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const el=new Element(m[1]);el.doc=document;el.hidden=/\bhidden\b/.test(m[2]);
    for(const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g))el.attributes[a[1]]=a[2];
    elements[m[3]]=el;
  }
  const listeners={};
  const history={state:null,pushState(state){this.state=state;},replaceState(state){this.state=state;},back(){this.state=null;}};
  const context=vm.createContext({URL,AbortController,setTimeout,clearTimeout,Date,Map,Set,Promise,console,history,
    navigator:{},scrollY:0,scrollTo(position){this.scrollY=position.top;},location:{href:options.href||'https://example.test/kids-youtube/'},document,
    localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>{if(options.noStorage)throw new Error('quota');store.set(k,v);}},
    fetch:async(url,opts)=>{calls.push({url:String(url),opts});if(String(url)==='./videos.txt')return options.offline?fail():json(config);return api(String(url),opts);},
    addEventListener:(k,fn)=>(listeners[k]??=[]).push(fn)});
  context.window=context;
  vm.runInContext(scripts[0],context,{filename:'service-worker-registration.js'});
  vm.runInContext(scripts[1],context,{filename:'index-inline.js'});
  await until(()=>!vm.runInContext('loading',context));
  return {context,elements,calls,store,document,listeners,run:code=>vm.runInContext(code,context)};
}
const plain = obj => JSON.parse(JSON.stringify(obj));

test('inline JS and service worker parse, no external scripts/frameworks',()=>{
  scripts.forEach(s=>new vm.Script(s));new vm.Script(fs.readFileSync(path.join(root,'sw.js'),'utf8'));
  assert.equal(scripts.length,2);assert.doesNotMatch(html,/<script[^>]+src=/);
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
  assert.equal(a.run('displayed.size'),3);assert.equal(a.run(`displayed.get('${id(1)}').title`),'הכותרת של ההורה');
  assert.equal(new URL(a.calls[2].url).searchParams.get('continuation'),'next+/?=&');
});
test('maxVideos strictly limits output and stops additional page requests',async()=>{
  const a=await app({videos:[],channels:[{id:A,name:'A',maxVideos:2}]},()=>json({videos:[row(1),row(2),row(3)],continuation:'more'}));
  assert.equal(a.run('displayed.size'),2);assert.equal(a.calls.length,2);
});
test('repeated pagination token stops an infinite loop',async()=>{
  const a=await app({videos:[],channels:[{id:A}]},()=>json({videos:[row(1)],continuation:'same'}));
  assert.equal(a.calls.length,3);assert.equal(a.run('displayed.size'),1);
});
test('safety limit stops after 100 pages',async()=>{
  let page=0;
  const a=await app({videos:[],channels:[{id:A}]},()=>json({videos:[row(++page)],continuation:String(page)}));
  assert.equal(page,100);assert.equal(a.run('displayed.size'),100);
});
test('channel instance fallback and last-working instance are persisted',async()=>{
  const a=await app({videos:[],channels:[{id:A}]},url=>url.includes('nerdvpn')?fail():json({videos:[row(1)],continuation:null}));
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
test('player enforces approved IDs and the required URL parameters',async()=>{
  const a=await app({videos:[{id:id(1),title:'סרטון שלנו'}],channels:[]},()=>json({videoId:id(1)}));
  a.run(`openPlayer('${id(9)}')`);assert.equal(a.elements.player.hidden,true);
  a.run(`openPlayer('${id(1)}')`);await until(()=>!!a.elements['video-frame'].src);
  const url=new URL(a.elements['video-frame'].src);
  assert.equal(url.pathname,'/embed/'+id(1));
  for(const [k,v] of Object.entries({autoplay:'1',related_videos:'false',continue:'0',comments:'false',iv_load_policy:'3'}))assert.equal(url.searchParams.get(k),v);
  assert.equal(a.elements.app.inert,true);assert.equal(a.elements.player.hidden,false);
  const sandbox=a.elements['video-frame'].attributes.sandbox;assert.doesNotMatch(sandbox,/top-navigation|popups|forms/);
  a.run('closePlayer()');assert.equal(a.elements['video-frame'].src,'');assert.equal(a.elements.player.hidden,true);assert.equal(a.elements.app.inert,false);
});
test('player metadata failure automatically advances to the next instance',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]},url=>url.includes('nerdvpn')?fail():json({videoId:id(1)}));
  a.run(`openPlayer('${id(1)}')`);await until(()=>!!a.elements['video-frame'].src);
  assert.match(a.elements['video-frame'].src,/tiekoetter/);a.run('closePlayer()');
});
test('all player attempts failing show a friendly retry state',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]},fail);
  a.run(`openPlayer('${id(1)}')`);await until(()=>!a.elements['player-error'].hidden);
  assert.equal(a.elements['video-frame'].src,'');assert.equal(a.elements['video-frame'].hidden,true);a.run('closePlayer()');
});
test('closing during player preflight cancels request and never reopens frame',async()=>{
  const a=await app({videos:[{id:id(1)}],channels:[]},(url,opts)=>new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new Error('aborted')))));
  a.run(`openPlayer('${id(1)}')`);a.run('closePlayer()');await new Promise(r=>setTimeout(r,5));
  assert.equal(a.elements['video-frame'].src,'');assert.equal(a.elements.player.hidden,true);
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
  let work;handlers.install({waitUntil:p=>work=p});await work;assert.equal(skip,1);assert.equal(cached.size,4);
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
  const a=await app(link(1),url=>url.includes('nerdvpn')?fail():metadataApi(url));
  assert.equal(a.calls.length,3);assert.equal(a.run('activeConfig.videos[0].title'),'שם הסרטון האוטומטי');
  assert.match(a.store.get('kidsYoutubeLastInstance'),/tiekoetter/);
});
test('mismatched video metadata is rejected before accepting the next instance',async()=>{
  const a=await app(link(1),url=>url.includes('nerdvpn')?json({videoId:id(2),title:'wrong'}):metadataApi(url));
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
  assert.equal(b.run('displayed.size'),0);assert.equal(b.calls.length,5);
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
  const a=await app(list,url=>url.includes('/resolveurl?')?json({ucid:B}):url.endsWith('/'+B)?json({authorId:B,author:'ערוץ חדש'}):fail(),store);
  assert.equal(a.run('activeConfig.channels[0].id'),B);assert.equal(a.run('displayed.size'),0);
  assert.deepEqual(Object.keys(JSON.parse(store.get('kidsYoutubeVideos')).channelLists),[B]);
});
test('plain channel list paginates and deduplicates automatically with manual video precedence',async()=>{
  const a=await app(link(1)+'\n'+channelLink(A),url=>url.includes('/channels/')&&new URL(url).pathname.endsWith('/videos')?json(new URL(url).searchParams.has('continuation')?{videos:[row(2),row(3)],continuation:null}:{videos:[row(1),row(2)],continuation:'page2'}):metadataApi(url));
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
function inputSearch(a,query) {
  a.elements.search.value=query;
  a.elements.search.listeners.input[0]();
}
function clickGrid(a,card) {
  a.elements.grid.listeners.click[0]({target:{closest:()=>card}});
}
test('default video tab combines manual approvals and approved channels',async()=>{
  const a=await app({videos:[{id:id(3),title:'ידני'}],channels:[{id:A,name:'מאיר'}]},metadataApi);
  assert.deepEqual(visibleVideoIds(a),[id(3),id(1),id(2)]);
  assert.equal(a.elements['videos-tab'].getAttribute('aria-pressed'),'true');
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
  inputSearch(a,'שיר');assert.deepEqual(visibleVideoIds(a),[id(3)]);
  inputSearch(a,'יוצר יחיד');assert.deepEqual(visibleVideoIds(a),[id(3)]);
  inputSearch(a,'מאיר');assert.deepEqual(visibleVideoIds(a),[id(1),id(2)]);
  inputSearch(a,'מאיר 2');assert.deepEqual(visibleVideoIds(a),[id(2)]);
  assert.equal(a.calls.length,count);
});
test('manual/channel duplicate remains searchable by its approved channel name',async()=>{
  const a=await app({videos:[{id:id(1),title:'כותרת ידנית'}],channels:[{id:A,name:'מאיר'}]},metadataApi);
  inputSearch(a,'מאיר');assert.deepEqual(visibleVideoIds(a),[id(1),id(2)]);
  assert.equal(a.elements.grid.children[0].children[1].textContent,'כותרת ידנית');
});
test('channel card opens only its own videos, including deduplicated manual approvals',async()=>{
  const a=await app({videos:[{id:id(1),title:'ידני'},{id:id(3),title:'בחוץ'}],channels:[{id:A,name:'מאיר'},{id:B,name:'אחר'}]},url=>json({videos:[row(url.includes(B)?4:1,url.includes(B)?B:A)],continuation:null}));
  a.elements['channels-tab'].listeners.click[0]();clickGrid(a,a.elements.grid.children[0]);
  assert.deepEqual(visibleVideoIds(a),[id(1)]);assert.equal(a.elements['channel-heading'].hidden,false);
  assert.equal(a.elements['channel-name'].textContent,'מאיר');
  inputSearch(a,'בחוץ');assert.equal(a.elements.grid.children.length,0);
  assert.equal(a.elements.player.hidden,true);
});
test('channel name search filters channel cards and clear button restores all',async()=>{
  const a=await app({videos:[],channels:[{id:A,name:'מאיר'},{id:B,name:'סיפורים'}]},()=>json({videos:[],continuation:null}));
  a.elements['channels-tab'].listeners.click[0]();inputSearch(a,'סיפורים');
  assert.deepEqual(a.elements.grid.children.map(card=>card.dataset.channelId),[B]);
  a.elements['clear-search'].listeners.click[0]();assert.equal(a.elements.grid.children.length,2);
  assert.equal(a.elements.search.value,'');assert.equal(a.elements['clear-search'].hidden,true);
});
test('no matches shows a friendly reset and keeps the approved authorization map',async()=>{
  const a=await app({videos:[{id:id(1),title:'מאושר'}],channels:[]});
  inputSearch(a,'לא קיים');assert.equal(a.elements.empty.hidden,false);assert.match(a.elements['empty-title'].textContent,/לא מצאנו/);
  assert.equal(a.elements['empty-clear'].hidden,false);assert.equal(a.elements.more.hidden,true);assert.equal(a.run('displayed.size'),1);
  a.elements['empty-clear'].listeners.click[0]();assert.deepEqual(visibleVideoIds(a),[id(1)]);assert.equal(a.elements.empty.hidden,true);
});
test('more cards apply the current filter and never show excluded videos',async()=>{
  const videos=Array.from({length:130},(_,i)=>({id:id(i),title:i<70?'שיר מאושר':'סיפור מאושר'}));
  const a=await app({videos,channels:[]});inputSearch(a,'שיר');
  assert.equal(a.elements.grid.children.length,60);assert.equal(a.elements.more.hidden,false);
  a.elements.more.listeners.click[0]();assert.equal(a.elements.grid.children.length,70);assert.equal(a.elements.more.hidden,true);
  assert.ok(a.elements.grid.children.every(card=>card.children[1].textContent==='שיר מאושר'));
});
test('tab switching preserves each list search, card limit and scroll position',async()=>{
  const a=await app({videos:[{id:id(1),title:'שיר'}],channels:[{id:A,name:'מאיר'}]},metadataApi);
  inputSearch(a,'שיר');a.run('visibleCount=120; window.scrollY=440');
  a.elements['channels-tab'].listeners.click[0]();assert.equal(a.elements.search.value,'');assert.equal(a.run('window.scrollY'),0);
  inputSearch(a,'מאיר');a.run('window.scrollY=180');a.elements['videos-tab'].listeners.click[0]();
  assert.equal(a.elements.search.value,'שיר');assert.equal(a.run('visibleCount'),120);assert.equal(a.run('window.scrollY'),440);
  a.elements['channels-tab'].listeners.click[0]();assert.equal(a.elements.search.value,'מאיר');assert.equal(a.run('window.scrollY'),180);
});
test('returning from a channel restores its channel-list search and position',async()=>{
  const a=await app({videos:[],channels:[{id:A,name:'מאיר'}]},metadataApi);
  a.elements['channels-tab'].listeners.click[0]();inputSearch(a,'מאיר');a.run('window.scrollY=300');clickGrid(a,a.elements.grid.children[0]);
  inputSearch(a,'2');a.elements['back-channels'].listeners.click[0]();
  assert.equal(a.elements.search.value,'מאיר');assert.equal(a.run('window.scrollY'),300);assert.equal(a.elements['channel-heading'].hidden,true);
  clickGrid(a,a.elements.grid.children[0]);assert.equal(a.elements.search.value,'2');assert.deepEqual(visibleVideoIds(a),[id(2)]);
});
test('closing the player preserves channel, search, more-card limit and scroll',async()=>{
  const a=await app({videos:[],channels:[{id:A,name:'מאיר'}]},url=>url.includes('/channels/')?metadataApi(url):json({videoId:id(2)}));
  a.run(`switchBrowse('channels','${A}')`);inputSearch(a,'2');a.run('visibleCount=120; window.scrollY=500');
  const card=a.elements.grid.children[0];card.focus();clickGrid(a,card);
  await until(()=>!a.elements['video-frame'].hidden);a.run('window.scrollY=0; closePlayer(true)');
  assert.equal(a.elements['video-frame'].src,'');assert.equal(a.elements.player.hidden,true);
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
  inputSearch(a,'https://youtube.com/watch?v='+id(2));assert.equal(a.calls.length,count);assert.equal(a.elements.grid.children.length,0);
  a.run(`openPlayer('${id(2)}')`);assert.equal(a.elements.player.hidden,true);
  inputSearch(a,'<script>alert(1)</script>');assert.equal(a.calls.length,count);
});
test('navigation stays visible and search controls have large tablet touch targets',()=>{
  assert.match(html,/\.browse-controls \{ position:sticky/);assert.match(html,/\.tab \{[^}]*min-height:64px/);
  assert.match(html,/<label[^>]*for="search"/);assert.match(html,/id="search" type="search"/);
  assert.match(html,/id="back-channels"/);assert.doesNotMatch(html,/api\/v1\/search/);
});
