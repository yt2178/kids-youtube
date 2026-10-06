const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const links=require('../parent-links.js');
const html=fs.readFileSync('parents.html','utf8');
const script=fs.readFileSync('parents.js','utf8');
const video='https://www.youtube.com/watch?v=mVTlbvQ_010';
const other='https://www.youtube.com/watch?v=AAAAAAAAAAA';
const channel='https://www.youtube.com/channel/UCV6xoqUxJzkWwCbDmEwMSYw';

test('parent video share canonicalizes equivalent links',()=>{
  assert.equal(links.share('title '+video+' https://youtu.be/mVTlbvQ_010?si=x').url,video);
});
test('parent channel UC and Unicode handles identify as channels',()=>{
  assert.equal(links.share(channel).kind,'channel');
  assert.equal(links.classify('https://youtube.com/@ערוץ').kind,'channel');
});
test('parent rejects multiple different shares and unsafe URLs',()=>{
  assert.throws(()=>links.share(video+' '+other));
  for(const value of ['javascript:alert(1)','https://youtube.com.evil.test/watch?v=mVTlbvQ_010','https://x@youtube.com/watch?v=mVTlbvQ_010','https://youtube.com/playlist?list=1','https://youtu.be/invalid','https://youtube.com/@bad%2Fpath'])
    assert.throws(()=>links.classify(value));
});
test('list edit preserves notes, deduplicates and revokes only the requested approval',()=>{
  let raw='// note\n'+other+'\n'+channel+'\n';
  raw=links.edit(raw,{operation:'add',link:video,note:'test'});
  assert.equal(links.entries(raw).length,3);
  assert.equal(links.entries(raw).find(x=>x.url===video).note,'test');
  assert.equal(links.edit(raw,{operation:'add',link:'https://youtu.be/mVTlbvQ_010'}),raw);
  const removed=links.edit(raw,{operation:'remove',link:video});
  assert.equal(links.entries(removed).length,2);assert.ok(removed.includes(other));assert.ok(removed.includes(channel));
});
test('parent helper no longer contains a GitHub issue approval path',()=>{
  assert.equal('issueURL' in links,false);
  assert.doesNotMatch(fs.readFileSync('parent-links.js','utf8'),/issues\/new|parent-approval/);
});

class Element{
  constructor(tag='div',fragment=false){this.tagName=tag;this.fragment=fragment;this.hidden=false;this.children=[];this.listeners={};this.dataset={};this.attributes={};this.value='';this.checked=false;this.disabled=false;this.textContent='';this.className='';this.isConnected=true;this.doc=null;}
  append(...nodes){for(const node of nodes){if(node.fragment)this.children.push(...node.children);else this.children.push(node);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  setAttribute(k,v){this.attributes[k]=String(v);}
  getAttribute(k){return this.attributes[k]??null;}
  removeAttribute(k){delete this.attributes[k];if(k==='src')this.src='';}
  focus(){if(this.doc)this.doc.activeElement=this;}
  contains(target){if(this===target)return true;return this.children.some(c=>c.contains?c.contains(target):c===target);}
  closest(selector){if(selector==='button[data-url]'&&this.tagName==='button'&&this.dataset.url)return this;return null;}
  querySelectorAll(selector){
    const out=[];const walk=node=>{for(const child of node.children||[]){if(selector==='button[data-url]'&&child.tagName==='button'&&child.dataset.url)out.push(child);walk(child);}};walk(this);return out;
  }
}
const response=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>data});
async function until(check){for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,2));}throw Error('condition timeout');}
function storage(map){return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};}
function parentApp({setup=false,password='good',list='',remembered='',session='' }={}){
  const elements={};const document={activeElement:null,createElement:tag=>{const e=new Element(tag);e.doc=document;return e;},createDocumentFragment:()=>{const e=new Element('fragment',true);e.doc=document;return e;},getElementById:id=>elements[id]};
  for(const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
    const el=new Element(match[1]);el.doc=document;el.hidden=/\bhidden\b/.test(match[2]);
    for(const a of match[2].matchAll(/([\w-]+)="([^"]*)"/g))el.attributes[a[1]]=a[2];
    elements[match[3]]=el;
  }
  elements.remember.checked=true;
  const local=new Map(),sess=new Map();if(remembered)local.set('kidsParentToken',remembered);if(session)sess.set('kidsParentToken',session);
  const calls=[];const state={setupRequired:setup,list,validTokens:new Set([remembered,session].filter(Boolean))};
  const fetch=async(url,options={})=>{
    const action=new URL(String(url)).searchParams.get('action');const body=options.body?JSON.parse(options.body):{};const auth=(options.headers&&options.headers.Authorization||'').replace(/^Bearer\s+/,'');
    calls.push({action,method:options.method||'GET',body,auth});
    if(action==='list')return response(200,{list:state.list,setupRequired:state.setupRequired});
    if(action==='status')return response(200,{authenticated:state.validTokens.has(auth),setupRequired:state.setupRequired});
    if(action==='setup'){
      if(!state.setupRequired)return response(409,{error:'ALREADY_SETUP'});
      if(typeof body.password!=='string'||body.password.length<4)return response(400,{error:'BAD_PASSWORD'});
      state.setupRequired=false;const token='setup-token';state.validTokens.add(token);return response(200,{token});
    }
    if(action==='login'){
      if(state.setupRequired)return response(409,{error:'SETUP_REQUIRED'});
      if(body.password!==password)return response(401,{error:'WRONG_PASSWORD'});
      const token='login-token';state.validTokens.add(token);return response(200,{token});
    }
    if(action==='mutate'){
      if(!state.validTokens.has(auth))return response(401,{error:'UNAUTHORIZED'});
      const before=state.list;state.list=links.edit(state.list,{operation:body.operation,link:body.link,note:body.note});
      return response(200,{ok:true,changed:before!==state.list,list:state.list});
    }
    return response(404,{error:'NOT_FOUND'});
  };
  const context=vm.createContext({document,fetch,KidsParentLinks:links,localStorage:storage(local),sessionStorage:storage(sess),setTimeout,clearTimeout,URL,JSON,console});
  context.window=context;
  vm.runInContext(script,context,{filename:'parents.js'});
  return {elements,document,local,sess,state,calls,context};
}
async function click(el,type='click',event={}){for(const fn of el.listeners[type]||[])await fn({preventDefault(){},key:'',target:el,...event});}

test('parent page exposes only the direct password flow, not GitHub approval controls',()=>{
  assert.match(html,/type="password"/);assert.match(html,/זכור אותי/);assert.match(html,/id="logout"/);
  assert.doesNotMatch(html,/GitHub|operation|המשך לאישור/);
  assert.doesNotMatch(script,/issueURL|github\.com|location\.assign/);
});
test('first setup stores a remembered session and opens parent management',async()=>{
  const a=parentApp({setup:true});await until(()=>a.elements['auth-title'].textContent==='בחירת סיסמה ראשונה');
  a.elements.password.value='abcd';await click(a.elements.login);await until(()=>a.elements['parent-area'].hidden===false);
  assert.equal(a.local.get('kidsParentToken'),'setup-token');assert.equal(a.sess.has('kidsParentToken'),false);
  assert.ok(a.calls.some(c=>c.action==='setup'));assert.equal(a.elements.auth.hidden,true);
});
test('normal login can use session-only memory and wrong password stays locked',async()=>{
  const wrong=parentApp();await until(()=>wrong.calls.some(c=>c.action==='list'));wrong.elements.password.value='bad';await click(wrong.elements.login);
  assert.equal(wrong.elements['parent-area'].hidden,true);assert.match(wrong.elements['auth-status'].textContent,/סיסמה שגויה/);
  const a=parentApp();await until(()=>a.calls.some(c=>c.action==='list'));a.elements.remember.checked=false;a.elements.password.value='good';await click(a.elements.login);await until(()=>!a.elements['parent-area'].hidden);
  assert.equal(a.local.has('kidsParentToken'),false);assert.equal(a.sess.get('kidsParentToken'),'login-token');
});
test('remembered parent token restores the management screen without password entry',async()=>{
  const a=parentApp({remembered:'remembered'});await until(()=>!a.elements['parent-area'].hidden);
  assert.ok(a.calls.some(c=>c.action==='status'&&c.auth==='remembered'));assert.equal(a.elements.auth.hidden,true);
});
test('approved list is rendered as safe cards and add saves directly through mutate',async()=>{
  const a=parentApp({remembered:'remembered',list:other+' // קיים\n'});await until(()=>!a.elements['parent-area'].hidden);
  assert.equal(a.elements.approved.children.length,1);assert.equal(a.elements['approved-count'].textContent,'1 מאושרים');
  a.elements.link.value='https://youtu.be/mVTlbvQ_010?si=x';await click(a.elements.inspect);
  assert.equal(a.elements.preview.hidden,false);a.elements.checked.checked=true;await click(a.elements.checked,'change');
  assert.equal(a.elements.save.disabled,false);await click(a.elements.save);await until(()=>links.entries(a.state.list).length===2);
  assert.ok(a.calls.some(c=>c.action==='mutate'&&c.body.operation==='add'));assert.match(a.elements.status.textContent,/נוסף לילדים/);
});
test('removal requires a deliberate second click and updates the direct backend',async()=>{
  const a=parentApp({remembered:'remembered',list:video+'\n'});await until(()=>!a.elements['parent-area'].hidden);
  const button=a.elements.approved.querySelectorAll('button[data-url]')[0];assert.ok(button);
  await click(a.elements.approved,'click',{target:button});assert.equal(links.entries(a.state.list).length,1);assert.match(button.textContent,/שוב/);
  await click(a.elements.approved,'click',{target:button});await until(()=>links.entries(a.state.list).length===0);
  assert.ok(a.calls.some(c=>c.action==='mutate'&&c.body.operation==='remove'));assert.match(a.elements['list-status'].textContent,/הוסר/);
});
test('logout clears remembered credentials and returns to the locked screen',async()=>{
  const a=parentApp({remembered:'remembered'});await until(()=>!a.elements['parent-area'].hidden);
  await click(a.elements.logout);assert.equal(a.local.has('kidsParentToken'),false);assert.equal(a.sess.has('kidsParentToken'),false);
  assert.equal(a.elements['parent-area'].hidden,true);assert.equal(a.elements.auth.hidden,false);assert.match(a.elements['auth-status'].textContent,/יצאת/);
});
