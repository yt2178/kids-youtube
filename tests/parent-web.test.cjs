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
  assert.match(html,/שם הסרטון\/הערוץ\/הערה אחרת \(לא חובה\)/);assert.match(html,/parents\.js\?v=20261008c/);assert.doesNotMatch(html,/פתח ב־YouTube|id="verify"/);
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
  const ids=['auth','auth-title','auth-help','auth-spinner','password','remember','login','auth-status','parent-area','link','inspect','status','preview','kind','media-title','media-author','youtube-player-shell','youtube-player-loading','youtube-player','channel-image-loading','channel-image','channel-symbol','canonical','note','save','channel-warning','approved-cards','approved-text','manual-editor','cards-mode','manual-mode','save-list','list-status','refresh-list','management-tab','catalog-tab','management-view','catalog-view','parent-catalog','parent-catalog-loading','catalog-player-dialog','catalog-player-title','catalog-player-loading','catalog-player','catalog-player-close','logout','remove-dialog','remove-name','remove-link','cancel-remove','confirm-remove'];
  const elements=Object.fromEntries(ids.map(id=>[id,new ParentElement()]));elements.auth.hidden=false;elements['parent-area'].hidden=true;elements.preview.hidden=true;elements['manual-editor'].hidden=true;elements.remember.checked=true;
  let reloads=0;const calls=[],windowListeners={};const context=vm.createContext({
    document:{getElementById:id=>elements[id],createElement:()=>new ParentElement()},localStorage:memoryStorage(local),sessionStorage:memoryStorage(session),
    KidsParentLinks:links,URL,Map,Object,String,JSON,Error,AbortController,encodeURIComponent,setTimeout,clearTimeout,confirm:()=>true,location:{origin:'https://example.test',reload(){reloads++;}},addEventListener:(k,fn)=>(windowListeners[k]??=[]).push(fn),
    fetch:async(url,options={})=>{const action=new URL(String(url)).searchParams.get('action');calls.push({action,options});const work=Promise.resolve().then(()=>handler(action,options));const result=options.signal?await Promise.race([work,new Promise((_,reject)=>{if(options.signal.aborted){const e=Error('aborted');e.name='AbortError';reject(e);return;}options.signal.addEventListener('abort',()=>{const e=Error('aborted');e.name='AbortError';reject(e);},{once:true});})]):await work;return {ok:result.status===undefined||result.status<400,status:result.status??200,json:async()=>result.body??result};}
  });
  context.window=context;context.top=context;vm.runInContext(fs.readFileSync('parents.js','utf8'),context,{filename:'parents.js'});await new Promise(r=>setImmediate(r));
  async function fire(id,type='click'){for(const fn of elements[id].listeners[type]||[])await fn();await new Promise(r=>setImmediate(r));}
  return {elements,calls,local,session,windowListeners,fire,reloads:()=>reloads};
}

test('parent management refuses to boot when framed, including by the same origin',async()=>{
  const local=new Map([['kidsParentToken','secret']]);let requests=0;
  const elements={};
  const ids=['auth','auth-title','auth-help','auth-spinner','password','remember','login','auth-status','parent-area','link','inspect','status','preview','kind','media-title','media-author','youtube-player-shell','youtube-player-loading','youtube-player','channel-image-loading','channel-image','channel-symbol','canonical','note','save','channel-warning','approved-cards','approved-text','manual-editor','cards-mode','manual-mode','save-list','list-status','refresh-list','management-tab','catalog-tab','management-view','catalog-view','parent-catalog','parent-catalog-loading','catalog-player-dialog','catalog-player-title','catalog-player-loading','catalog-player','catalog-player-close','logout','remove-dialog','remove-name','remove-link','cancel-remove','confirm-remove'];
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
  const ids=['auth','auth-title','auth-help','auth-spinner','password','remember','login','auth-status','parent-area','link','inspect','status','preview','kind','media-title','media-author','youtube-player-shell','youtube-player-loading','youtube-player','channel-image-loading','channel-image','channel-symbol','canonical','note','save','channel-warning','approved-cards','approved-text','manual-editor','cards-mode','manual-mode','save-list','list-status','refresh-list','management-tab','catalog-tab','management-view','catalog-view','parent-catalog','parent-catalog-loading','catalog-player-dialog','catalog-player-title','catalog-player-loading','catalog-player','catalog-player-close','logout','remove-dialog','remove-name','remove-link','cancel-remove','confirm-remove'];
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
