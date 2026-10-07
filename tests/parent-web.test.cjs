const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const links=require('../parent-links.js');
const video='https://www.youtube.com/watch?v=mVTlbvQ_010',other='https://www.youtube.com/watch?v=AAAAAAAAAAA',channel='https://www.youtube.com/channel/UCV6xoqUxJzkWwCbDmEwMSYw';

test('parent video share canonicalizes and deduplicates equivalent links',()=>assert.equal(
  links.share('title '+video+' https://youtu.be/mVTlbvQ_010?si=x').url,video
));
test('parent channel UC and Unicode handles identify as channels',()=>{
  assert.equal(links.share(channel).kind,'channel');
  assert.equal(links.classify('https://youtube.com/@ערוץ').kind,'channel');
});
test('parent rejects multiple different video shares',()=>assert.throws(()=>links.share(video+' '+other)));
test('parent rejects malicious hosts, credentials, schemes, playlists and invalid IDs',()=>{
  for(const value of [
    'javascript:alert(1)',
    'https://youtube.com.evil.test/watch?v=mVTlbvQ_010',
    'https://x@youtube.com/watch?v=mVTlbvQ_010',
    'https://youtube.com/playlist?list=1',
    'https://youtu.be/invalid',
    'https://youtube.com/@bad%2Fpath'
  ]) assert.throws(()=>links.classify(value));
});
test('legacy GitHub issue mutation helpers are no longer exposed',()=>{
  assert.deepEqual(Object.keys(links).sort(),['classify','share']);
});
test('parent page uses password login, remembered session and direct backend save without GitHub navigation',()=>{
  const html=fs.readFileSync('parents.html','utf8'),script=fs.readFileSync('parents.js','utf8');
  assert.match(html,/type="password"/);assert.match(html,/זכור אותי/);
  assert.match(script,/localStorage/);assert.match(script,/sessionStorage/);
  assert.match(script,/functions\/v1\/kids-youtube/);
  assert.match(script,/encodeURIComponent\(action\)/);assert.match(script,/mutate/);
  assert.match(script,/logout/);
  assert.doesNotMatch(script,/github\.com|issues\/new|issueURL/);
  assert.doesNotMatch(html,/GitHub|המשך לאישור/);
});


class ParentElement {
  constructor(){this.hidden=false;this.value='';this.checked=false;this.disabled=false;this.textContent='';this.href='';this.src='';this.dataset={};this.listeners={};}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  removeAttribute(name){if(name==='src')this.src='';}
}
function memoryStorage(map){return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};}
async function parentApp(handler,{local=new Map(),session=new Map()}={}){
  const ids=['auth','auth-title','auth-help','password','remember','login','auth-status','parent-area','link','inspect','status','preview','kind','thumbnail','channel-symbol','identified','canonical','verify','operation','note','checked','save','channel-warning','approved','refresh-list','logout'];
  const elements=Object.fromEntries(ids.map(id=>[id,new ParentElement()]));
  elements.auth.hidden=false;elements['parent-area'].hidden=true;elements.preview.hidden=true;elements.remember.checked=true;elements.operation.value='add';elements.save.disabled=true;
  let reloads=0;const calls=[];
  const context=vm.createContext({
    document:{getElementById:id=>elements[id]},
    localStorage:memoryStorage(local),sessionStorage:memoryStorage(session),
    KidsParentLinks:links,URL,Map,Object,String,JSON,Error,encodeURIComponent,
    location:{reload(){reloads++;}},
    fetch:async(url,options={})=>{
      const action=new URL(String(url)).searchParams.get('action');calls.push({action,options});
      const result=await handler(action,options);
      return {ok:result.status===undefined||result.status<400,status:result.status??200,json:async()=>result.body??result};
    }
  });
  vm.runInContext(fs.readFileSync('parents.js','utf8'),context,{filename:'parents.js'});
  await new Promise(r=>setImmediate(r));
  async function fire(id,type='click'){for(const fn of elements[id].listeners[type]||[])await fn();await new Promise(r=>setImmediate(r));}
  return {elements,calls,local,session,fire,reloads:()=>reloads};
}
test('obsolete GitHub issue approval path stays removed',()=>{
  for(const path of [
    '.github/workflows/parent-approval.yml',
    '.github/ISSUE_TEMPLATE/parent-approval.yml',
    'scripts/parent-approval.cjs'
  ]) assert.equal(fs.existsSync(path),false,path);
  const docs=fs.readFileSync('PARENTS.md','utf8');
  assert.doesNotMatch(docs,/issues\/new|Submit new issue|Create issue|הרשאת כתיבה לריפו/);
});


test('remembered parent session opens the parent area without another password',async()=>{
  const local=new Map([['kidsParentToken','remembered-token']]);
  const app=await parentApp(async(action,options)=>{
    if(action==='list')return {list:video+'\n',setupRequired:false};
    if(action==='status'){assert.equal(options.headers.Authorization,'Bearer remembered-token');return {authenticated:true,setupRequired:false};}
    throw Error(action);
  },{local});
  assert.equal(app.elements.auth.hidden,true);assert.equal(app.elements['parent-area'].hidden,false);
  assert.match(app.elements.approved.textContent,/mVTlbvQ_010/);
});

test('parent login can be remembered and direct save uses bearer session',async()=>{
  const app=await parentApp(async(action,options)=>{
    if(action==='list')return {list:'',setupRequired:false};
    if(action==='login'){const body=JSON.parse(options.body);assert.equal(body.password,'1234');return {token:'fresh-token'};}
    if(action==='mutate'){
      assert.equal(options.headers.Authorization,'Bearer fresh-token');
      const body=JSON.parse(options.body);assert.equal(body.operation,'add');assert.equal(body.link,video);
      return {changed:true,list:video+'\n'};
    }
    throw Error(action);
  });
  app.elements.password.value='1234';await app.fire('login');
  assert.equal(app.local.get('kidsParentToken'),'fresh-token');assert.equal(app.elements['parent-area'].hidden,false);
  app.elements.link.value=video;await app.fire('inspect');
  app.elements.checked.checked=true;await app.fire('checked','change');
  assert.equal(app.elements.save.disabled,false);await app.fire('save');
  assert.match(app.elements.status.textContent,/נוסף לילדים/);assert.match(app.elements.approved.textContent,/mVTlbvQ_010/);
});

test('invalid remembered session is cleared and logout clears both session stores',async()=>{
  const local=new Map([['kidsParentToken','bad-token']]),session=new Map([['kidsParentToken','other-token']]);
  const app=await parentApp(async action=>{
    if(action==='list')return {list:'',setupRequired:false};
    if(action==='status')return {authenticated:false,setupRequired:false};
    throw Error(action);
  },{local,session});
  assert.equal(local.has('kidsParentToken'),false);assert.equal(session.has('kidsParentToken'),false);
  assert.equal(app.elements.auth.hidden,false);assert.equal(app.elements['parent-area'].hidden,true);
  local.set('kidsParentToken','again');session.set('kidsParentToken','again2');await app.fire('logout');
  assert.equal(local.has('kidsParentToken'),false);assert.equal(session.has('kidsParentToken'),false);assert.equal(app.reloads(),1);
});
