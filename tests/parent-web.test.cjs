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
  assert.match(html,/האם אתה בטוח שברצונך להסיר/);assert.match(html,/youtube-player/);assert.match(html,/frame-src https:\/\/www\.youtube\.com/);
  assert.match(html,/שם הסרטון או הערוץ, או הערה אחרת/);assert.match(html,/פתח ב־YouTube/);
  assert.doesNotMatch(html,/מה עושים\?|ביטול אישור|פתחתי את הקישור ובדקתי|הערה לעצמי/);
  assert.match(script,/action,'replace'|api\('replace'/);assert.match(script,/api\('metadata'/);assert.match(script,/operation:'remove'/);
  assert.match(script,/youtube\.com\/embed/);assert.doesNotMatch(script,/github\.com|issues\/new|issueURL/);
});

class ParentElement{
  constructor(){this.hidden=false;this.value='';this.checked=false;this.disabled=false;this.textContent='';this.href='';this.src='';this.open=false;this.children=[];this.listeners={};this.className='';this.type='';this.classList={toggle(){}};}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);} removeAttribute(name){if(name==='src')this.src='';}
  append(...x){this.children.push(...x);} replaceChildren(...x){this.children=[...x];} showModal(){this.open=true;} close(){this.open=false;}
}
function memoryStorage(map){return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};}
async function parentApp(handler,{local=new Map(),session=new Map()}={}){
  const ids=['auth','auth-title','auth-help','password','remember','login','auth-status','parent-area','link','inspect','status','preview','kind','media-title','media-author','youtube-player','channel-symbol','canonical','verify','note','save','channel-warning','approved-cards','approved-text','manual-editor','cards-mode','manual-mode','save-list','list-status','refresh-list','logout','remove-dialog','remove-name','remove-link','cancel-remove','confirm-remove'];
  const elements=Object.fromEntries(ids.map(id=>[id,new ParentElement()]));elements.auth.hidden=false;elements['parent-area'].hidden=true;elements.preview.hidden=true;elements.remember.checked=true;
  let reloads=0;const calls=[];const context=vm.createContext({
    document:{getElementById:id=>elements[id],createElement:()=>new ParentElement()},localStorage:memoryStorage(local),sessionStorage:memoryStorage(session),
    KidsParentLinks:links,URL,Map,Object,String,JSON,Error,encodeURIComponent,confirm:()=>true,location:{reload(){reloads++;}},
    fetch:async(url,options={})=>{const action=new URL(String(url)).searchParams.get('action');calls.push({action,options});const result=await handler(action,options);return {ok:result.status===undefined||result.status<400,status:result.status??200,json:async()=>result.body??result};}
  });
  vm.runInContext(fs.readFileSync('parents.js','utf8'),context,{filename:'parents.js'});await new Promise(r=>setImmediate(r));
  async function fire(id,type='click'){for(const fn of elements[id].listeners[type]||[])await fn();await new Promise(r=>setImmediate(r));}
  return {elements,calls,local,session,fire,reloads:()=>reloads};
}

test('remembered parent session renders approved cards',async()=>{
  const local=new Map([['kidsParentToken','remembered-token']]);
  const app=await parentApp(async(action,options)=>{if(action==='list')return {list:video+' // ילד טרמפולינה\n',setupRequired:false};if(action==='status'){assert.equal(options.headers.Authorization,'Bearer remembered-token');return {authenticated:true};}throw Error(action);},{local});
  assert.equal(app.elements.auth.hidden,true);assert.equal(app.elements['parent-area'].hidden,false);assert.equal(app.elements['approved-cards'].children.length,1);assert.equal(app.elements['approved-cards'].children[0].children[0].textContent,'ילד טרמפולינה');
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
  await app.fire('save');assert.match(app.elements.status.textContent,/נוסף לילדים/);
});

test('manual editor replaces the whole approved list through authenticated backend',async()=>{
  const local=new Map([['kidsParentToken','token']]);
  const app=await parentApp(async(action)=>{if(action==='list')return {list:video+'\n',setupRequired:false};if(action==='status')return {authenticated:true};if(action==='replace')return {changed:true,list:channel+' // ערוץ מאיר\n'};throw Error(action);},{local});
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

test('invalid remembered session is cleared and logout clears both stores',async()=>{
  const local=new Map([['kidsParentToken','bad']]),session=new Map([['kidsParentToken','other']]);
  const app=await parentApp(async action=>{if(action==='list')return {list:'',setupRequired:false};if(action==='status')return {authenticated:false};throw Error(action);},{local,session});
  assert.equal(local.has('kidsParentToken'),false);assert.equal(session.has('kidsParentToken'),false);local.set('kidsParentToken','x');session.set('kidsParentToken','y');await app.fire('logout');assert.equal(local.has('kidsParentToken'),false);assert.equal(session.has('kidsParentToken'),false);assert.equal(app.reloads(),1);
});
