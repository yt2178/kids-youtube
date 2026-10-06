/* SPDX-License-Identifier: GPL-3.0-or-later */
'use strict';
const API='https://jxhelpxhrmwvzrrfrjuh.supabase.co/functions/v1/kids-youtube';
const ids=['auth','auth-title','auth-help','password','remember','login','auth-status','parent-area','logout','link','inspect','status','preview','kind','thumbnail','channel-symbol','identified','canonical','verify','note','checked','save','channel-warning','approved','approved-count','list-status','refresh-list'];
const ui=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));
let parentLink=null,setupRequired=false,currentList='';

function token(){try{return localStorage.getItem('kidsParentToken')||sessionStorage.getItem('kidsParentToken')||'';}catch(_){return '';}}
function storeToken(value,remember){try{localStorage.removeItem('kidsParentToken');sessionStorage.removeItem('kidsParentToken');(remember?localStorage:sessionStorage).setItem('kidsParentToken',value);}catch(_){}}
function clearToken(){try{localStorage.removeItem('kidsParentToken');sessionStorage.removeItem('kidsParentToken');}catch(_){}}
async function api(action,options={}){
  const headers={'Content-Type':'application/json',...(options.auth&&token()?{Authorization:'Bearer '+token()}:{})};
  const response=await fetch(API+'?action='+encodeURIComponent(action),{method:options.method||'GET',headers,body:options.body?JSON.stringify(options.body):undefined,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(Error(data.error||'FAILED'),{status:response.status});
  return data;
}
function authExpired(){
  clearToken();
  ui['parent-area'].hidden=true;ui.auth.hidden=false;ui.password.value='';
  ui['auth-status'].textContent='הכניסה פגה. הזינו שוב את הסיסמה.';
}
function showParent(list){
  ui.auth.hidden=true;ui['parent-area'].hidden=false;renderList(list||'');
}
function make(tag,className,text){
  const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;
}
function renderList(raw){
  currentList=String(raw||'');
  let entries=[];
  try{entries=KidsParentLinks.entries(currentList);}catch(_){}
  ui['approved-count'].textContent=entries.length?entries.length.toLocaleString('he-IL')+' מאושרים':'';
  const fragment=document.createDocumentFragment();
  if(!entries.length){
    fragment.append(make('div','approved-empty','אין עדיין תוכן מאושר.'));
  }else for(const entry of entries){
    const row=make('article','approved-item');
    let visual;
    if(entry.kind==='video'){
      visual=document.createElement('img');visual.className='approved-thumb';visual.src='https://img.youtube.com/vi/'+entry.id+'/mqdefault.jpg';
      visual.alt='';visual.loading='lazy';visual.decoding='async';visual.referrerPolicy='no-referrer';
      visual.addEventListener('error',()=>{visual.hidden=true;},{once:true});
    }else{visual=make('div','approved-symbol','📺');visual.setAttribute('aria-hidden','true');}
    const info=make('div','approved-info');
    info.append(make('div','approved-type',entry.kind==='video'?'▶ סרטון':'📺 ערוץ'));
    info.append(make('div','approved-url',entry.url));
    if(entry.note)info.append(make('div','approved-note','הערה: '+entry.note));
    const remove=make('button','remove danger','הסר');
    remove.type='button';remove.dataset.url=entry.url;remove.dataset.confirm='0';
    remove.setAttribute('aria-label','הסרת '+(entry.kind==='video'?'סרטון':'ערוץ')+' מהרשימה');
    row.append(visual,info,remove);fragment.append(row);
  }
  ui.approved.replaceChildren(fragment);
}
async function loadList(render=true){
  const data=await api('list');setupRequired=!!data.setupRequired;
  if(render)renderList(data.list);
  return data;
}
async function boot(){
  try{
    const data=await loadList(false);
    if(token()){
      try{
        const state=await api('status',{method:'POST',auth:true});
        if(state.authenticated){showParent(data.list);return;}
      }catch(_){}
      clearToken();
    }
    ui['auth-title'].textContent=setupRequired?'בחירת סיסמה ראשונה':'כניסת הורה';
    ui['auth-help'].textContent=setupRequired?'בחרו סיסמה משפחתית. מהכניסה הבאה אפשר לזכור את ההורה במכשיר.':'הזינו את הסיסמה המשפחתית.';
    ui.password.setAttribute('autocomplete',setupRequired?'new-password':'current-password');
  }catch(_){ui['auth-status'].textContent='לא הצלחנו להתחבר כרגע. נסו שוב.';}
}
async function login(){
  if(ui.login.disabled)return;
  ui.login.disabled=true;ui['auth-status'].textContent='';
  try{
    const password=ui.password.value;
    if(password.length<4){ui['auth-status'].textContent='הסיסמה צריכה להכיל לפחות 4 תווים.';return;}
    const data=await api(setupRequired?'setup':'login',{method:'POST',body:{password,remember:ui.remember.checked}});
    storeToken(data.token,ui.remember.checked);
    const list=await loadList(false);ui.password.value='';showParent(list.list);
  }catch(error){
    ui['auth-status'].textContent=error.message==='WRONG_PASSWORD'?'סיסמה שגויה.':'הכניסה לא הצליחה. נסו שוב.';
  }finally{ui.login.disabled=false;}
}
ui.login.addEventListener('click',login);
ui.password.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();login();}});

function resetPreview(){
  parentLink=null;ui.preview.hidden=true;ui.checked.checked=false;ui.save.disabled=true;
  ui.thumbnail.removeAttribute('src');ui.status.textContent='';
}
ui.link.addEventListener('input',resetPreview);
ui.inspect.addEventListener('click',()=>{
  resetPreview();
  try{
    parentLink=KidsParentLinks.share(ui.link.value);const channel=parentLink.kind==='channel';
    ui.kind.textContent=channel?'📺 ערוץ שלם':'▶ סרטון אחד';
    ui.identified.textContent=channel?'בדקו שזה הערוץ שרציתם לאשר.':'בדקו שזה הסרטון שרציתם לאשר.';
    ui.canonical.textContent=parentLink.url;ui.verify.href=parentLink.url;
    ui.thumbnail.hidden=channel;ui['channel-symbol'].hidden=!channel;
    if(!channel)ui.thumbnail.src='https://img.youtube.com/vi/'+parentLink.id+'/hqdefault.jpg';
    ui['channel-warning'].hidden=!channel;ui.preview.hidden=false;
    ui.status.textContent='הקישור זוהה. פתחו ובדקו אותו לפני ההוספה.';
  }catch(_){ui.status.textContent='הדביקו קישור אחד של סרטון או ערוץ YouTube.';}
});
ui.thumbnail.addEventListener('error',()=>{ui.thumbnail.hidden=true;});
ui.checked.addEventListener('change',()=>{ui.save.disabled=!parentLink||!ui.checked.checked;});

async function mutate(operation,link,note=''){
  try{
    return await api('mutate',{method:'POST',auth:true,body:{operation,link,note}});
  }catch(error){
    if(error.status===401){authExpired();return null;}
    throw error;
  }
}
ui.save.addEventListener('click',async()=>{
  if(!parentLink||!ui.checked.checked||ui.save.disabled)return;
  ui.save.disabled=true;ui.status.textContent='שומר…';
  const link=parentLink.url;
  try{
    const data=await mutate('add',link,ui.note.value);if(!data)return;
    renderList(data.list);
    ui.link.value='';ui.note.value='';resetPreview();
    ui.status.textContent=data.changed?'נוסף לילדים ✓':'הקישור כבר מאושר.';
  }catch(_){ui.status.textContent='השמירה לא הצליחה. נסו שוב.';}
});

let removeResetTimer=null;
ui.approved.addEventListener('click',async event=>{
  const button=event.target.closest('button[data-url]');if(!button||!ui.approved.contains(button))return;
  if(button.dataset.confirm!=='1'){
    for(const other of ui.approved.querySelectorAll('button[data-url]')){other.dataset.confirm='0';other.textContent='הסר';other.disabled=false;}
    button.dataset.confirm='1';button.textContent='לחצו שוב להסרה';
    clearTimeout(removeResetTimer);removeResetTimer=setTimeout(()=>{if(button.isConnected){button.dataset.confirm='0';button.textContent='הסר';}},4000);
    return;
  }
  clearTimeout(removeResetTimer);button.disabled=true;ui['list-status'].textContent='מסיר…';
  try{
    const data=await mutate('remove',button.dataset.url);if(!data)return;
    renderList(data.list);ui['list-status'].textContent=data.changed?'הוסר מהרשימה ✓':'הפריט כבר לא היה ברשימה.';
  }catch(_){button.disabled=false;ui['list-status'].textContent='לא הצלחנו להסיר. נסו שוב.';}
});
ui['refresh-list'].addEventListener('click',async()=>{
  ui['refresh-list'].disabled=true;ui['list-status'].textContent='מרענן…';
  try{await loadList(true);ui['list-status'].textContent='הרשימה מעודכנת ✓';}
  catch(_){ui['list-status'].textContent='לא הצלחנו לרענן כרגע.';}
  finally{ui['refresh-list'].disabled=false;}
});
ui.logout.addEventListener('click',()=>{clearToken();ui['parent-area'].hidden=true;ui.auth.hidden=false;ui['auth-status'].textContent='יצאת מאזור ההורים.';ui.password.focus();});
boot();
