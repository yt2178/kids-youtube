const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const links=require('../parent-links.js');
const video='https://www.youtube.com/watch?v=mVTlbvQ_010',other='https://www.youtube.com/watch?v=AAAAAAAAAAA',channel='https://www.youtube.com/channel/UCV6xoqUxJzkWwCbDmEwMSYw';

test('parent video share canonicalizes equivalent links',()=>assert.equal(links.share('title '+video+' https://youtu.be/mVTlbvQ_010?si=x').url,video));
test('parent channel UC and Unicode handles identify as channels',()=>{assert.equal(links.share(channel).kind,'channel');assert.equal(links.classify('https://youtube.com/@ערוץ').kind,'channel');});
test('parent rejects multiple different shares and unsafe links',()=>{assert.throws(()=>links.share(video+' '+other));for(const value of ['javascript:alert(1)','https://youtube.com.evil.test/watch?v=mVTlbvQ_010','https://x@youtube.com/watch?v=mVTlbvQ_010','https://youtube.com/playlist?list=1','https://youtu.be/invalid'])assert.throws(()=>links.classify(value));});
test('legacy GitHub mutation helpers stay removed',()=>assert.deepEqual(Object.keys(links).sort(),['classify','share']));

test('parent HTML has direct editor, row mode, removal confirmation and embedded YouTube support',()=>{
  const html=fs.readFileSync('parents.html','utf8'),script=fs.readFileSync('parents.js','utf8');
  assert.match(html,/עריכה ידנית/);assert.match(html,/תצוגת שורות/);assert.match(html,/שמור את הרשימה/);
  assert.match(html,/להסיר את הפריט הזה מהרשימה/);assert.match(html,/youtube-player/);assert.match(html,/frame-src 'self' https:\/\/www\.youtube\.com/);
  assert.match(html,/font-src 'self';/);assert.doesNotMatch(html,/web-share|clipboard-write/);assert.doesNotMatch(html,/fonts\.gstatic\.com|https:\/\/\*\./);assert.match(html,/id="channel-image"/);assert.match(html,/id="parent-catalog-loading"/);assert.doesNotMatch(html,/id="parent-catalog"[^>]+loading="lazy"/);
  assert.match(html,/שם הסרטון\/הערוץ\/הפלייליסט\/הערה אחרת \(לא חובה\)/);assert.match(html,/parents\.js\?v=20261020a/);assert.match(html,/id="management-search-panel"[^>]*hidden/);assert.match(html,/id="management-search-toggle"[^>]*aria-expanded="false"/);assert.doesNotMatch(html,/פתח ב־YouTube|id="verify"/);
  assert.doesNotMatch(html,/מה עושים\?|ביטול אישור|פתחתי את הקישור ובדקתי|הערה לעצמי/);
  assert.match(script,/action,'replace'|api\('replace'/);assert.match(script,/api\('metadata'/);assert.match(script,/operation:'remove'/);
  assert.match(script,/youtube\.com\/embed/);assert.doesNotMatch(script,/github\.com|issues\/new|issueURL/);
});

class ParentElement{
  constructor(){this.hidden=false;this.value='';this.checked=false;this.disabled=false;this.textContent='';this.href='';this.src='';this.open=false;this.children=[];this.listeners={};this.attributes={};this.className='';this.type='';this.contentWindow={};this.classList={toggle(){},add(){},remove(){}};}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);} setAttribute(name,value){this.attributes[name]=String(value);} removeAttribute(name){if(name==='src')this.src='';else delete this.attributes[name];}
  append(...x){this.children.push(...x);} replaceChildren(...x){this.children=[...x];} showModal(){this.open=true;} close(){this.open=false;}
}
function memoryStorage(map){return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};}
async function parentApp(handler,{local=new Map(),session=new Map()}={}){
  const ids=['management-search-toggle','management-search-panel','search-query','search-submit','search-status','search-results','search-more','auth','auth-title','auth-help','auth-spinner','password','remember','login','auth-status','parent-area','link','inspect','status','preview','kind','media-title','media-author','youtube-player-shell','youtube-player-loading','youtube-player','channel-image-loading','channel-image','channel-symbol','canonical','note','save','channel-warning','approved-cards','approved-text','manual-editor','cards-mode','manual-mode','save-list','list-status','refresh-list','management-tab','catalog-tab','management-view','catalog-view','parent-catalog','parent-catalog-loading','catalog-player-dialog','catalog-player-title','catalog-player-loading','catalog-player','catalog-player-close','logout','remove-dialog','remove-name','remove-link','cancel-remove','confirm-remove'];
  const elements=Object.fromEntries(ids.map(id=>[id,new ParentElement()]));elements.auth.hidden=false;elements['parent-area'].hidden=true;elements.preview.hidden=true;elements['manual-editor'].hidden=true;elements['management-search-panel'].hidden=true;elements['management-search-toggle'].attributes['aria-expanded']='false';elements.remember.checked=true;
  let reloads=0;const calls=[],windowListeners={};const context=vm.createContext({
    document:{getElementById:id=>elements[id],createElement:()=>new ParentElement()},localStorage:memoryStorage(local),sessionStorage:memoryStorage(session),
    KidsParentLinks:links,URL,Map,Object,String,JSON,Error,AbortController,encodeURIComponent,setTimeout,clearTimeout,confirm:()=>true,location:{origin:'https://example.test',reload(){reloads++;}},addEventListener:(k,fn)=>(windowListeners[k]??=[]).push(fn),
    fetch:async(url,options={})=>{const action=new URL(String(url)).pathname.endsWith('/kids-youtube-search')?'search':new URL(String(url)).searchParams.get('action');calls.push({action,options});const work=Promise.resolve().then(()=>handler(action,options));const result=options.signal?await Promise.race([work,new Promise((_,reject)=>{if(options.signal.aborted){const e=Error('aborted');e.name='AbortError';reject(e);return;}options.signal.addEventListener('abort',()=>{const e=Error('aborted');e.name='AbortError';reject(e);},{once:true});})]):await work;return {ok:result.status===undefined||result.status<400,status:result.status??200,json:async()=>result.body??result};}
  });
  context.window=context;context.top=context;vm.runInContext(fs.readFileSync('parents.js','utf8'),context,{filename:'parents.js'});await new Promise(r=>setImmediate(r));
  async function fire(id,type='click'){for(const fn of elements[id].listeners[type]||[])await fn();await new Promise(r=>setImmediate(r));}
  return {elements,calls,local,session,windowListeners,fire,reloads:()=>reloads};
}

test('parent management refuses to boot when framed, including by the same origin',async()=>{
  const local=new Map([['kidsParentToken','secret']]);let requests=0;
  const elements={};
  const ids=['management-search-toggle','management-search-panel','search-query','search-submit','search-status','search-results','search-more','auth','auth-title','auth-help','auth-spinner','password','remember','login','auth-status','parent-area','link','inspect','status','preview','kind','media-title','media-author','youtube-player-shell','youtube-player-loading','youtube-player','channel-image-loading','channel-image','channel-symbol','canonical','note','save','channel-warning','approved-cards','approved-text','manual-editor','cards-mode','manual-mode','save-list','list-status','refresh-list','management-tab','catalog-tab','management-view','catalog-view','parent-catalog','parent-catalog-loading','catalog-player-dialog','catalog-player-title','catalog-player-loading','catalog-player','catalog-player-close','logout','remove-dialog','remove-name','remove-link','cancel-remove','confirm-remove'];
  for(const id of ids)elements[id]=new ParentElement();
  const context=vm.createContext({
    document:{getElementById:id=>elements[id],createElement:()=>new ParentElement()},
    localStorage:memoryStorage(local),sessionStorage:memoryStorage(new Map()),KidsParentLinks:links,URL,Map,Object,String,JSON,Error,AbortController,encodeURIComponent,setTimeout,clearTimeout,
    confirm:()=>true,location:{origin:'https://example.test',reload(){}},fetch:async()=>{requests++;return {ok:true,status:200,json:async()=>({})};},addEventListener(){},
  });
  context.window=context;context.top={location:{get origin(){throw new Error('cross-origin');}}};
  vm.runInContext(fs.readFileSync('parents.js','utf8'),context,{filename:'parents.js'});
  await new Promise(r=>setImmediate(r));
  assert.equal(requests,0);assert.equal(elements.login.disabled,true);assert.match(elements['auth-status'].textContent,/לפתוח את אתר ההורים ישירות/);
  assert.equal(local.get('kidsParentToken'),'secret');
});

test('parent management trust boundary is top-level only',()=>{
  const source=fs.readFileSync('parents.js','utf8');assert.match(source,/const TRUSTED_FRAME=window\.top===window/);
});

test('parent Supabase requests have a finite browser-side deadline and abort signal',async()=>{
  const source=fs.readFileSync('parents.js','utf8');
  assert.match(source,/PARENT_REQUEST_TIMEOUT_MS=20000/);assert.match(source,/new AbortController\(\)/);assert.match(source,/signal:controller\.signal/);
  assert.match(source,/error&&error\.name==='AbortError'/);
});

test('stalled parent Supabase request is actually aborted by the browser deadline',async()=>{
  const source=fs.readFileSync('parents.js','utf8').replace('PARENT_REQUEST_TIMEOUT_MS=20000','PARENT_REQUEST_TIMEOUT_MS=5');
  const ids=['management-search-toggle','management-search-panel','search-query','search-submit','search-status','search-results','search-more','auth','auth-title','auth-help','auth-spinner','password','remember','login','auth-status','parent-area','link','inspect','status','preview','kind','media-title','media-author','youtube-player-shell','youtube-player-loading','youtube-player','channel-image-loading','channel-image','channel-symbol','canonical','note','save','channel-warning','approved-cards','approved-text','manual-editor','cards-mode','manual-mode','save-list','list-status','refresh-list','management-tab','catalog-tab','management-view','catalog-view','parent-catalog','parent-catalog-loading','catalog-player-dialog','catalog-player-title','catalog-player-loading','catalog-player','catalog-player-close','logout','remove-dialog','remove-name','remove-link','cancel-remove','confirm-remove'];
  const elements=Object.fromEntries(ids.map(id=>[id,new ParentElement()]));elements.auth.hidden=false;elements['parent-area'].hidden=true;elements['auth-spinner'].hidden=true;
  let aborted=false;
  const context=vm.createContext({document:{getElementById:id=>elements[id],createElement:()=>new ParentElement()},localStorage:memoryStorage(new Map()),sessionStorage:memoryStorage(new Map()),KidsParentLinks:links,URL,Map,Object,String,JSON,Error,AbortController,encodeURIComponent,setTimeout,clearTimeout,confirm:()=>true,location:{origin:'https://example.test',reload(){}},addEventListener(){},fetch:(_url,options)=>new Promise((_resolve,reject)=>{options.signal.addEventListener('abort',()=>{aborted=true;const e=Error('aborted');e.name='AbortError';reject(e);},{once:true});})});
  context.window=context;context.top=context;vm.runInContext(source,context,{filename:'parents-timeout.js'});
  await new Promise(r=>setTimeout(r,20));
  assert.equal(aborted,true);assert.match(elements['auth-status'].textContent,/לא הצלחנו להתחבר כרגע/);assert.equal(elements['auth-spinner'].hidden,true);
});

test('channel image loading has a finite deadline and falls back cleanly',()=>{
  const source=fs.readFileSync('parents.js','utf8');
  assert.match(source,/CHANNEL_IMAGE_TIMEOUT_MS=8000/);
  assert.match(source,/channelImageDeadline=setTimeout/);
  assert.match(source,/removeAttribute\('src'\);ui\['channel-symbol'\]\.hidden=false/);
});

test('remembered parent session renders approved cards',async()=>{
  const local=new Map([['kidsParentToken','remembered-token']]);
  const app=await parentApp(async(action,options)=>{if(action==='list')return {list:video+' // ילד טרמפולינה\n',setupRequired:false};if(action==='status'){assert.equal(options.headers.Authorization,'Bearer remembered-token');return {authenticated:true};}throw Error(action);},{local});
  assert.equal(app.elements.auth.hidden,true);assert.equal(app.elements['parent-area'].hidden,false);assert.equal(app.elements['approved-cards'].children.length,1);assert.equal(app.elements['approved-cards'].children[0].children[0].textContent,'ילד טרמפולינה');
  const firstList=app.calls.find(x=>x.action==='list');assert.equal(firstList.options.headers['Content-Type'],undefined);
});

test('inspect gets metadata, embeds video, prefills name and add saves it',async()=>{
  const app=await parentApp(async(action,options)=>{
    if(action==='list')return {list:'',setupRequired:false};
    if(action==='login')return {token:'fresh-token'};
    if(action==='metadata'){assert.equal(options.headers.Authorization,'Bearer fresh-token');return {url:video,kind:'video',id:'mVTlbvQ_010',title:'ילד טרמפולינה',author:'שמחה פרידמן'};}
    if(action==='mutate'){const body=JSON.parse(options.body);assert.equal(body.operation,'add');assert.equal(body.note,'ילד טרמפולינה');return {changed:true,list:video+' // ילד טרמפולינה\n'};}
    throw Error(action);
  });
  app.elements.password.value='1234';await app.fire('login');app.elements.link.value=video;await app.fire('inspect');
  assert.equal(app.elements['media-title'].textContent,'ילד טרמפולינה');assert.equal(app.elements.note.value,'ילד טרמפולינה');assert.match(app.elements['youtube-player'].src,/youtube\.com\/embed\/mVTlbvQ_010/);
  assert.equal(app.elements['youtube-player-loading'].hidden,false);await app.fire('youtube-player','load');assert.equal(app.elements['youtube-player-loading'].hidden,true);
  await app.fire('save');assert.match(app.elements.status.textContent,/נוסף לרשימה/);assert.equal(app.elements.save.disabled,false);
});


test('channel preview shows the real safe channel image and falls back only on image failure',async()=>{
  const local=new Map([['kidsParentToken','token']]);
  const app=await parentApp(async action=>{
    if(action==='list')return {list:'https://www.youtube.com/@meirshows // ערוץ מאיר\n',setupRequired:false};
    if(action==='status')return {authenticated:true};
    if(action==='metadata')return {url:'https://www.youtube.com/@meirshows',kind:'channel',id:null,title:'ערוץ מאיר לילדים',author:'',thumbnail:'https://yt3.googleusercontent.com/example'};
    throw Error(action);
  },{local});
  app.elements.link.value='https://www.youtube.com/@meirshows';await app.fire('inspect');
  assert.equal(app.elements['channel-image-loading'].hidden,true);assert.equal(app.elements['channel-image'].hidden,true);assert.equal(app.elements['channel-image'].src,'https://yt3.googleusercontent.com/example');
  await new Promise(r=>setTimeout(r,190));assert.equal(app.elements['channel-image-loading'].hidden,false);
  assert.equal(app.elements['channel-symbol'].hidden,true);
  await app.fire('channel-image','load');assert.equal(app.elements['channel-image-loading'].hidden,true);assert.equal(app.elements['channel-image'].hidden,false);
  app.elements['channel-image-loading'].hidden=false;await app.fire('channel-image','error');
  assert.equal(app.elements['channel-image-loading'].hidden,true);assert.equal(app.elements['channel-image'].hidden,true);assert.equal(app.elements['channel-symbol'].hidden,false);
});

test('hidden parent views unload YouTube iframes and restore preview only when needed',async()=>{
  const local=new Map([['kidsParentToken','token']]);
  const app=await parentApp(async action=>{
    if(action==='list')return {list:'',setupRequired:false};
    if(action==='status')return {authenticated:true};
    if(action==='metadata')return {url:video,kind:'video',id:'mVTlbvQ_010',title:'ילד טרמפולינה',author:'שמחה פרידמן'};
    throw Error(action);
  },{local});
  app.elements.link.value=video;await app.fire('inspect');assert.match(app.elements['youtube-player'].src,/youtube\.com\/embed/);
  await app.fire('catalog-tab');assert.equal(app.elements['youtube-player'].src,'');assert.match(app.elements['parent-catalog'].src,/parentCatalog=1/);
  await app.fire('management-tab');assert.equal(app.elements['parent-catalog'].src,'');assert.match(app.elements['youtube-player'].src,/youtube\.com\/embed/);
});

test('existing approved channel is detected through equivalent canonical channel URLs',async()=>{
  const local=new Map([['kidsParentToken','token']]);
  const app=await parentApp(async action=>{
    if(action==='list')return {list:'https://www.youtube.com/@meirshows // ערוץ מאיר\n',setupRequired:false};
    if(action==='status')return {authenticated:true};
    if(action==='metadata')return {url:'https://www.youtube.com/@meirshows',kind:'channel',id:null,title:'ערוץ מאיר',author:'',thumbnail:''};
    throw Error(action);
  },{local});
  app.elements.link.value='https://youtube.com/@meirshows/videos';await app.fire('inspect');
  assert.match(app.elements.status.textContent,/כבר קיים ברשימה/);assert.equal(app.elements.save.disabled,true);
});

test('existing approved video is identified before save and duplicate add is disabled',async()=>{
  const local=new Map([['kidsParentToken','token']]);let mutateCalls=0;
  const app=await parentApp(async(action)=>{
    if(action==='list')return {list:video+' // ילד טרמפולינה\n',setupRequired:false};
    if(action==='status')return {authenticated:true};
    if(action==='metadata')return {url:video,kind:'video',id:'mVTlbvQ_010',title:'ילד טרמפולינה',author:'שמחה פרידמן'};
    if(action==='mutate'){mutateCalls++;return {changed:false,list:video+' // ילד טרמפולינה\n'};}
    throw Error(action);
  },{local});
  app.elements.link.value=video;await app.fire('inspect');
  assert.match(app.elements.status.textContent,/כבר קיים ברשימה/);
  assert.match(app.elements.status.textContent,/ילד טרמפולינה/);
  assert.equal(app.elements.save.textContent,'כבר קיים ברשימה');assert.equal(app.elements.save.disabled,true);
  assert.equal(mutateCalls,0);
});

test('manual editor replaces the whole approved list through authenticated backend',async()=>{
  const local=new Map([['kidsParentToken','token']]);
  const app=await parentApp(async(action)=>{if(action==='list')return {list:video+'\n',version:7,setupRequired:false};if(action==='status')return {authenticated:true};if(action==='replace')return {changed:true,list:channel+' // ערוץ מאיר\n',version:8};throw Error(action);},{local});
  await app.fire('manual-mode');assert.equal(app.elements['manual-editor'].hidden,false);app.elements['approved-text'].value=channel+' // ערוץ מאיר\n';await app.fire('save-list');
  assert.equal(app.elements['manual-editor'].hidden,true);assert.equal(app.elements['approved-cards'].children[0].children[0].textContent,'ערוץ מאיר');
});

test('remove button opens confirmation with name above link and removes only after confirmation',async()=>{
  const local=new Map([['kidsParentToken','token']]);
  const app=await parentApp(async(action,options)=>{if(action==='list')return {list:video+' // ניסים בלאק\n',setupRequired:false};if(action==='status')return {authenticated:true};if(action==='mutate'){const body=JSON.parse(options.body);assert.equal(body.operation,'remove');assert.equal(body.link,video);return {changed:true,list:''};}throw Error(action);},{local});
  const remove=app.elements['approved-cards'].children[0].children[2];for(const fn of remove.listeners.click||[])await fn();
  assert.equal(app.elements['remove-dialog'].open,true);assert.equal(app.elements['remove-name'].textContent,'ניסים בלאק');assert.equal(app.elements['remove-link'].textContent,video);
  await app.fire('confirm-remove');assert.equal(app.elements['remove-dialog'].open,false);assert.match(app.elements['list-status'].textContent,/הוסר/);
});


test('parent catalog reuses the child interface and opens only trusted iframe messages in embedded YouTube',async()=>{
  const local=new Map([['kidsParentToken','token']]);
  const app=await parentApp(async action=>{if(action==='list')return {list:video+' // ילד טרמפולינה\n',setupRequired:false};if(action==='status')return {authenticated:true};throw Error(action);},{local});
  await app.fire('catalog-tab');
  assert.equal(app.elements['catalog-view'].hidden,false);assert.match(app.elements['parent-catalog'].src,/index\.html\?parentCatalog=1/);assert.equal(app.elements['parent-catalog-loading'].hidden,false);
  await app.fire('parent-catalog','load');assert.equal(app.elements['parent-catalog-loading'].hidden,true);
  const handler=app.windowListeners.message[0],trusted=app.elements['parent-catalog'].contentWindow;
  handler({origin:'https://evil.test',source:trusted,data:{type:'kids-parent-open-video',id:'mVTlbvQ_010',title:'לא'}});assert.equal(app.elements['catalog-player-dialog'].open,false);
  handler({origin:'https://example.test',source:{},data:{type:'kids-parent-open-video',id:'mVTlbvQ_010',title:'לא'}});assert.equal(app.elements['catalog-player-dialog'].open,false);
  handler({origin:'https://example.test',source:trusted,data:{type:'kids-parent-open-video',id:'mVTlbvQ_010',title:'ילד טרמפולינה'}});
  assert.equal(app.elements['catalog-player-dialog'].open,true);assert.match(app.elements['catalog-player'].src,/youtube\.com\/embed\/mVTlbvQ_010/);assert.equal(app.elements['catalog-player-loading'].hidden,false);
  await app.fire('catalog-player','load');assert.equal(app.elements['catalog-player-loading'].hidden,true);
  assert.equal(app.elements['catalog-player-title'].textContent,'ילד טרמפולינה');
  await app.fire('management-tab');assert.equal(app.elements['parent-catalog'].src,'');
});

test('parent catalog authentication expiry clears the remembered token and reloads safely',async()=>{
  const local=new Map([['kidsParentToken','token']]);
  const app=await parentApp(async action=>{if(action==='list')return {list:video+'\n',setupRequired:false};if(action==='status')return {authenticated:true};throw Error(action);},{local});
  await app.fire('catalog-tab');const handler=app.windowListeners.message[0],trusted=app.elements['parent-catalog'].contentWindow;
  handler({origin:'https://example.test',source:trusted,data:{type:'kids-parent-auth-expired'}});
  assert.equal(local.has('kidsParentToken'),false);assert.equal(app.reloads(),1);assert.equal(app.elements['parent-catalog'].src,'');
});

test('invalid remembered session is cleared and logout clears both stores',async()=>{
  const local=new Map([['kidsParentToken','bad']]),session=new Map([['kidsParentToken','other']]);
  const app=await parentApp(async action=>{if(action==='list')return {list:'',setupRequired:false};if(action==='status')return {authenticated:false};throw Error(action);},{local,session});
  assert.equal(local.has('kidsParentToken'),false);assert.equal(session.has('kidsParentToken'),false);local.set('kidsParentToken','x');session.set('kidsParentToken','y');await app.fire('logout');assert.equal(local.has('kidsParentToken'),false);assert.equal(session.has('kidsParentToken'),false);assert.equal(app.reloads(),1);
});

test('manual save sends exact expectedVersion and conflict preserves edit',async()=>{
  const local=new Map([['kidsParentToken','token']]);
  const a=await parentApp(async(action,options)=>{
    if(action==='list')return {list:video+'\n',version:8,setupRequired:false};
    if(action==='status')return {authenticated:true};
    if(action==='replace'){
      const body=JSON.parse(options.body);
      assert.equal(body.expectedVersion,8);
      assert.equal(body.list,channel+' // proposed\n');
      return {status:409,body:{error:'CONFLICT'}};
    }
    throw Error(action);
  },{local});
  await a.fire('manual-mode');a.elements['approved-text'].value=channel+' // proposed\n';
  await a.fire('save-list');
  assert.equal(a.elements['manual-editor'].hidden,false);
  assert.equal(a.elements['approved-text'].value,channel+' // proposed\n');
  assert.match(a.elements['list-status'].textContent,/מכשיר אחר/);
});
test('late metadata after editing link must not create a stale preview',async()=>{
  let complete;const local=new Map([['kidsParentToken','token']]);
  const a=await parentApp(async action=>{
    if(action==='list')return {list:'',version:3,setupRequired:false};
    if(action==='status')return {authenticated:true};
    if(action==='metadata')return new Promise(resolve=>complete=resolve);
    throw Error(action);
  },{local});
  a.elements.link.value=video;
  const pending=a.elements.inspect.listeners.click[0]();await new Promise(r=>setImmediate(r));
  a.elements.link.value=channel;await a.fire('link','input');
  complete({url:video,kind:'video',id:'mVTlbvQ_010',title:'STALE CONTENT'});
  await pending;
  assert.equal(a.elements.preview.hidden,true);
  assert.equal(a.elements['youtube-player'].src,'');
});
test('logout aborts pending requests without reviving preview',async()=>{
  let finish;const local=new Map([['kidsParentToken','token']]);
  const a=await parentApp(async action=>{
    if(action==='list')return {list:'',version:2,setupRequired:false};
    if(action==='status')return {authenticated:true};
    if(action==='metadata')return new Promise(resolve=>finish=resolve);
    throw Error(action);
  },{local});
  a.elements.link.value=video;
  const pending=a.elements.inspect.listeners.click[0]();await new Promise(r=>setImmediate(r));
  await a.fire('logout');finish({url:video,kind:'video',id:'mVTlbvQ_010',title:'LATE'});
  await pending;assert.equal(local.has('kidsParentToken'),false);assert.equal(a.elements.preview.hidden,true);
});
test('two rapid save clicks create only one mutation request',async()=>{
  let complete,calls=0;const local=new Map([['kidsParentToken','token']]);
  const a=await parentApp(async action=>{
    if(action==='list')return {list:'',version:2,setupRequired:false};
    if(action==='status')return {authenticated:true};
    if(action==='metadata')return {url:video,kind:'video',id:'mVTlbvQ_010',title:'Approved'};
    if(action==='mutate'){calls++;return new Promise(resolve=>complete=resolve);}
    throw Error(action);
  },{local});
  a.elements.link.value=video;await a.fire('inspect');
  const first=a.elements.save.listeners.click[0]();
  const second=a.elements.save.listeners.click[0]();
  await new Promise(r=>setImmediate(r));assert.equal(calls,1);
  complete({changed:true,list:video+'\n',version:3});await Promise.all([first,second]);
});
test('leaving management during metadata loading prevents hidden iframe from appearing',async()=>{
  let finish;const local=new Map([['kidsParentToken','token']]);
  const a=await parentApp(async action=>{
    if(action==='list')return {list:'',version:2,setupRequired:false};
    if(action==='status')return {authenticated:true};
    if(action==='metadata')return new Promise(resolve=>finish=resolve);
    throw Error(action);
  },{local});
  a.elements.link.value=video;
  const pending=a.elements.inspect.listeners.click[0]();await new Promise(r=>setImmediate(r));
  await a.fire('catalog-tab');
  finish({url:video,kind:'video',id:'mVTlbvQ_010',title:'STALE'});
  await pending;assert.equal(a.elements['youtube-player'].src,'');
  assert.equal(a.elements.preview.hidden,true);
});

test('search is a compact labelled action beside, not inside, the category tabs',()=>{
  const html=fs.readFileSync('index.html','utf8');
  const nav=html.slice(html.indexOf('<nav class="tabs"'),html.indexOf('</nav>'));
  assert.ok(nav.includes('id="videos-tab"')&&nav.includes('id="channels-tab"')&&nav.includes('id="all-tab"'));
  assert.ok(!nav.includes('id="search-toggle"'),'search must not look like a fourth category tab');
  const row=html.slice(html.indexOf('<div class="browse-main-row">'),html.indexOf('</div>',html.indexOf('<div class="browse-main-row">')));
  assert.ok(row.includes('id="search-toggle"'),'search must be beside categories and clearly labelled');
  assert.match(html,/class="search-shortcut" id="search-toggle"[^>]*aria-controls="search-row"/);
  assert.equal(html.split('id="search-toggle"').length-1,1);
  const toolbar=html.slice(html.indexOf('<div class="toolbar">'),html.indexOf('<div class="status"'));
  assert.ok(toolbar.includes('id="sort-options"')&&toolbar.includes('id="view-grid"')&&toolbar.includes('id="view-list"'));
  assert.ok(Math.abs(toolbar.indexOf('id="sort-options"')-toolbar.indexOf('id="view-grid"'))<900,
    'sort must share the same toolbar with the card/list selector');
  assert.equal(html.split('id="sort-options"').length-1,1);
  assert.match(html,/id="search-row" hidden/);
});
test('closing parent search discards a late result, reopening permits a new search',async()=>{
  let resolveSearch,requests=0;
  const app=await parentApp(async action=>{
    if(action==='list')return {list:'',version:1};
    if(action==='status')return {authenticated:true};
    if(action==='search'){requests++;return requests===1?new Promise(resolve=>resolveSearch=resolve):{items:[{kind:'video',id:'mVTlbvQ_010',title:'חדש'}]};}
    throw Error(action);
  },{local:new Map([['kidsParentToken','parent']])});
  await app.fire('management-search-toggle');
  app.elements['search-query'].value='ברדק';
  const pending=app.fire('search-submit');
  await new Promise(resolve=>setImmediate(resolve));
  await app.fire('management-search-toggle');
  resolveSearch({items:[{kind:'video',id:'AAAAAAAAAAA',title:'ישן'}]});
  await pending;
  assert.equal(app.elements['search-results'].children.length,0);
  assert.equal(app.elements['search-submit'].disabled,false);
  await app.fire('management-search-toggle');
  await app.fire('search-submit');
  assert.equal(app.elements['search-results'].children[0].children[1].children[1].textContent,'חדש');
  assert.equal(requests,2);
});
test('management search is closed by default and opens only on its compact button',async()=>{
  const app=await parentApp(async action=>{
    if(action==='list')return {list:'',version:1};
    if(action==='status')return {authenticated:true};
    if(action==='search')return {items:[],nextPageToken:''};
    throw Error(action);
  },{local:new Map([['kidsParentToken','parent']])});
  assert.equal(app.elements['management-search-panel'].hidden,true);
  assert.equal(app.elements['management-search-toggle'].attributes['aria-expanded'],'false');
  app.elements['search-query'].value='ברדק';
  await app.fire('search-submit');
  assert.equal(app.calls.filter(call=>call.action==='search').length,0);
  await app.fire('management-search-toggle');
  assert.equal(app.elements['management-search-panel'].hidden,false);
  assert.equal(app.elements['management-search-toggle'].attributes['aria-expanded'],'true');
  await app.fire('search-submit');
  assert.equal(app.calls.filter(call=>call.action==='search').length,1);
  await app.fire('catalog-tab');
  assert.equal(app.elements['management-search-panel'].hidden,true);
  assert.equal(app.elements['management-search-toggle'].hidden,true);
  await app.fire('management-tab');
  assert.equal(app.elements['management-search-panel'].hidden,true);
  assert.equal(app.elements['management-search-toggle'].hidden,false);
});
test('exact channel match is followed by its videos, before unrelated channels and videos',async()=>{
  const app=await parentApp(async action=>{
    if(action==='list')return {list:'',version:1};
    if(action==='status')return {authenticated:true};
    if(action==='search')return {items:[
      {kind:'video',id:'AAAAAAAAAAA',title:'שיר זר',author:'אחר'},
      {kind:'channel',id:'UC'+'A'.repeat(22),title:'ברדק אחר'},
      {kind:'video',id:'mVTlbvQ_010',title:'השיר של ברדק',author:'ברדק'},
      {kind:'channel',id:'UC'+'B'.repeat(22),title:'ברדק'}
    ],nextPageToken:''};
    throw Error(action);
  },{local:new Map([['kidsParentToken','parent']])});
  await app.fire('management-search-toggle');app.elements['search-query'].value='ברדק';
  await app.fire('search-submit');
  const names=app.elements['search-results'].children.map(row=>row.children[1].children[1].textContent);
  assert.deepEqual(names,['ברדק','השיר של ברדק','ברדק אחר','שיר זר']);
  assert.equal(app.elements['search-results'].children[0].children[1].children[0].textContent,'ערוץ שלם');
});
test('parent search opens the official embedded YouTube player and adds once',async()=>{
 let finish,mutations=0;
 const app=await parentApp(async(action,options)=>{
  if(action==='list')return {list:'',version:7};if(action==='status')return {authenticated:true};
  if(action==='search'){assert.equal(options.headers.Authorization,'Bearer parent');assert.equal(JSON.parse(options.body).query,'שיר');return {items:[{kind:'video',id:'mVTlbvQ_010',title:'<b>Song</b>',author:'Artist'}],nextPageToken:'next'};}
  if(action==='mutate'){mutations++;assert.deepEqual(JSON.parse(options.body),{operation:'add',link:video,note:'<b>Song</b>'});return new Promise(resolve=>finish=resolve);}
  throw Error(action);
 },{local:new Map([['kidsParentToken','parent']])});
 await app.fire('management-search-toggle');app.elements['search-query'].value='שיר';await app.fire('search-submit');
 const row=app.elements['search-results'].children[0],info=row.children[1],actions=info.children[3],add=actions.children[1];
 assert.equal(info.children[1].textContent,'<b>Song</b>');
 assert.equal(info.children[1].type,'button');
 await info.children[1].listeners.click[0]();
 assert.equal(app.elements['catalog-player-dialog'].open,true);
 assert.ok(app.elements['catalog-player'].src.includes('youtube.com/embed/mVTlbvQ_010'));
 assert.equal(app.elements['catalog-player-title'].textContent,'<b>Song</b>');
 assert.equal(app.elements['catalog-player-loading'].hidden,false);
 await app.fire('catalog-player','load');assert.equal(app.elements['catalog-player-loading'].hidden,true);
 await app.fire('catalog-player-close');assert.equal(app.elements['catalog-player'].src,'');
 await actions.children[0].listeners.click[0]();
 assert.equal(app.elements['catalog-player-dialog'].open,true);
 await app.fire('catalog-player-close');
 const first=add.listeners.click[0]();await new Promise(r=>setImmediate(r));await add.listeners.click[0]();assert.equal(mutations,1);
 finish({list:video+'\n',version:8,changed:true});await first;assert.equal(add.disabled,true);assert.equal(add.textContent,'כבר מאושר');
});
test('search pagination deduplicates results and missing configuration has a clear message',async()=>{
 let count=0;const app=await parentApp(async(action,options)=>{
  if(action==='list')return {list:''};if(action==='status')return {authenticated:true};
  if(action==='search'){count++;if(count===3)return {status:503,body:{error:'SEARCH_NOT_CONFIGURED'}};
   assert.equal(JSON.parse(options.body).pageToken,count===1?'':'next');
   return {items:[{kind:'video',id:'mVTlbvQ_010',title:'Song'},...(count===2?[{kind:'video',id:'AAAAAAAAAAA',title:'Other'}]:[])],nextPageToken:count===1?'next':''};}throw Error(action);
 },{local:new Map([['kidsParentToken','parent']])});
 await app.fire('management-search-toggle');app.elements['search-query'].value='song';await app.fire('search-submit');await app.fire('search-more');
 assert.equal(app.elements['search-results'].children.length,2);assert.equal(app.elements['search-more'].hidden,true);
 await app.fire('search-submit');assert.match(app.elements['search-status'].textContent,/אינו זמין/);
});
test('logout invalidates a pending search without showing late results',async()=>{
 let finish;const app=await parentApp(async action=>{
 if(action==='list')return {list:''};if(action==='status')return {authenticated:true};if(action==='search')return new Promise(r=>finish=r);throw Error(action);
 },{local:new Map([['kidsParentToken','parent']])});
 await app.fire('management-search-toggle');app.elements['search-query'].value='song';const pending=app.fire('search-submit');await new Promise(r=>setImmediate(r));await app.fire('logout');finish({items:[{id:'AAAAAAAAAAA'}]});await pending;assert.equal(app.elements['search-results'].children.length,0);
});

test('channel search comes first, marks whole-channel approval, and adds canonical UC link only once',async()=>{
  const channelId='UCV6xoqUxJzkWwCbDmEwMSYw',channelUrl='https://www.youtube.com/channel/'+channelId;
  let mutations=0,release;
  const app=await parentApp(async(action,opts)=>{
    if(action==='list')return {list:'',version:1};
    if(action==='status')return {authenticated:true};
    if(action==='search')return {items:[
      {kind:'video',id:'mVTlbvQ_010',title:'ברדק שיר',author:'ברדק'},
      {kind:'channel',id:channelId,title:'ברדק',thumbnail:'https://yt3.googleusercontent.com/baradak'}
    ],nextPageToken:''};
    if(action==='mutate'){
      mutations++;
      assert.deepEqual(JSON.parse(opts.body),{operation:'add',link:channelUrl,note:'ברדק'});
      return new Promise(resolve=>release=resolve);
    }
    throw Error(action);
  },{local:new Map([['kidsParentToken','parent']])});
  await app.fire('management-search-toggle');app.elements['search-query'].value='ברדק';
  await app.fire('search-submit');
  const results=app.elements['search-results'].children;
  assert.equal(results.length,2);
  const channelRow=results[0],videoRow=results[1],info=channelRow.children[1];
  assert.match(channelRow.className,/search-channel/);
  assert.equal(info.children[0].textContent,'ערוץ שלם');
  assert.equal(info.children[1].textContent,'ברדק');
  assert.match(info.children[2].textContent,/כולל חדשים בעתיד/);
  assert.equal(videoRow.children[1].children[0].textContent,'סרטון');
  const channelAdd=info.children[3].children[1];
  assert.equal(channelAdd.textContent,'הוסף את כל הערוץ');
  // Clicking the channel title previews it without granting permission.
  await info.children[1].listeners.click[0]();
  assert.equal(app.elements.kind.textContent,'ערוץ שלם');
  assert.equal(app.elements.canonical.textContent,channelUrl);
  assert.equal(app.elements['channel-warning'].hidden,false);
  assert.equal(mutations,0);
  const first=channelAdd.listeners.click[0]();
  await new Promise(resolve=>setImmediate(resolve));
  await channelAdd.listeners.click[0]();
  assert.equal(mutations,1);
  release({list:channelUrl+' // ברדק\n',version:2,changed:true});
  await first;
  assert.equal(channelAdd.disabled,true);
  assert.equal(channelAdd.textContent,'כבר מאושר');
  assert.match(app.elements['search-status'].textContent,/הערוץ השלם אושר/);
});
test('channel thumbnail is restricted to Google image origins, not arbitrary URLs',async()=>{
  const channelId='UCV6xoqUxJzkWwCbDmEwMSYw';
  const app=await parentApp(async action=>{
    if(action==='list')return {list:'',version:1};
    if(action==='status')return {authenticated:true};
    if(action==='search')return {items:[{kind:'channel',id:channelId,title:'ערוץ מסוים',thumbnail:'https://evil.example/spy.jpg'}]};
    throw Error(action);
  },{local:new Map([['kidsParentToken','parent']])});
  await app.fire('management-search-toggle');app.elements['search-query'].value='ערוץ';await app.fire('search-submit');
  const visual=app.elements['search-results'].children[0].children[0];
  assert.equal(visual.children.length,1);
  assert.equal(visual.children[0].textContent,'ערוץ');
});

test('parent search retrieves a real safe avatar when a search channel result lacks one',async()=>{
 let metadataCalls=0;
 const channelId='UC'+'K'.repeat(22);
 const app=await parentApp(async action=>{
  if(action==='list')return {list:'',version:2};
  if(action==='status')return {authenticated:true};
  if(action==='search')return {items:[{kind:'channel',id:channelId,title:'ערוץ מאיר',thumbnail:''}],nextPageToken:''};
  if(action==='metadata'){metadataCalls++;return {kind:'channel',title:'ערוץ מאיר',thumbnail:'https://yt3.googleusercontent.com/meir-avatar'};}
  throw Error(action);
 },{local:new Map([['kidsParentToken','parent']])});
 await app.fire('management-search-toggle');
 app.elements['search-query'].value='מאיר';await app.fire('search-submit');
 await new Promise(resolve=>setImmediate(resolve));
 const visual=app.elements['search-results'].children[0].children[0];
 assert.equal(metadataCalls,1);
 assert.equal(visual.children[1].src,'https://yt3.googleusercontent.com/meir-avatar');
 await visual.children[1].listeners.load[0]();
 assert.equal(visual.children[0].hidden,true);
 assert.equal(visual.children[1].hidden,false);
});

test('refreshing an unchanged parent list preserves rendered row nodes and edit state',async()=>{
  const local=new Map([['kidsParentToken','token']]);
  const a=await parentApp(async action=>{
    if(action==='list')return {list:video+'\\n',version:3,setupRequired:false};
    if(action==='status')return {authenticated:true};
    throw Error('Unexpected '+action);
  },{local});
  const first=a.elements['approved-cards'].children[0];
  assert.ok(first);
  await a.fire('refresh-list');
  assert.equal(a.elements['approved-cards'].children[0],first,'unchanged approval cards are not rebuilt');
  assert.equal(a.elements['approved-text'].value,video+'\\n');
});

test('playlist links are explicit, canonical and do not turn a watch link into a blanket approval',()=>{
 const id='PLrfcruGtplwHxMQ6Wi2x0uVIrHF9uFcSz';
 assert.deepEqual(links.classify('https://youtube.com/playlist?list='+id+'&si=share'),{kind:'playlist',id,url:'https://www.youtube.com/playlist?list='+id,label:'פלייליסט YouTube'});
 assert.equal(links.classify(video+'&list='+id).kind,'video');
 for(const input of ['https://youtube.com/playlist?list=WL','https://youtube.com/playlist?list=LL','https://youtube.com/playlist?list=RDabcdefghijk','https://youtube.com/playlist?list='+id+'&list='+id])assert.throws(()=>links.classify(input));
});
test('parent previews and approves a playlist source once, checks membership and removes the source',async()=>{
 const url='https://www.youtube.com/playlist?list=PLrfcruGtplwHxMQ6Wi2x0uVIrHF9uFcSz';
 const local=new Map([['kidsParentToken','token']]);let stored='',checks=0,adds=0,removes=0;
 const a=await parentApp(async(action,options)=>{
  if(action==='list')return {list:stored,version:8};
  if(action==='status')return {authenticated:true};
  if(action==='metadata'){checks++;assert.equal(JSON.parse(options.body).link,url);return {kind:'playlist',url,title:'שלנו',count:4,author:'הורה',thumbnail:''};}
  if(action==='mutate'){const b=JSON.parse(options.body);assert.equal(b.link,url);if(b.operation==='add'){adds++;stored=url+' // שלנו\n';}else{removes++;stored='';}return {list:stored,version:9,changed:true};}
  throw Error(action);
 },{local});
 a.elements.link.value=url;await a.elements.inspect.listeners.click[0]();
 assert.match(a.elements.kind.textContent,/פלייליסט.*4/);assert.match(a.elements['channel-warning'].textContent,/הסרות/);
 assert.equal(a.elements['youtube-player'].src,'');
 await a.elements.save.listeners.click[0]();assert.equal(adds,1);assert.equal(stored.includes('watch?v='),false);
 const row=a.elements['approved-cards'].children[0];
 await row.children.find(x=>x.textContent==='בדוק פלייליסט').listeners.click[0]();assert.equal(checks,2);
 assert.match(row.children.at(-1).textContent,/4 סרטונים/);
 await row.children.find(x=>x.textContent==='הסר').listeners.click[0]();await a.elements['confirm-remove'].listeners.click[0]();assert.equal(removes,1);assert.equal(stored,'');
});
