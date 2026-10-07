/* SPDX-License-Identifier: GPL-3.0-or-later */
'use strict';
const API='https://jxhelpxhrmwvzrrfrjuh.supabase.co/functions/v1/kids-youtube';
const ids=['auth','auth-title','auth-help','password','remember','login','auth-status','parent-area','link','inspect','status','preview','kind','media-title','media-author','youtube-player','channel-symbol','canonical','note','save','channel-warning','approved-cards','approved-text','manual-editor','cards-mode','manual-mode','save-list','list-status','refresh-list','management-tab','catalog-tab','management-view','catalog-view','parent-catalog','catalog-player-dialog','catalog-player-title','catalog-player','catalog-player-close','logout','remove-dialog','remove-name','remove-link','cancel-remove','confirm-remove'];
const ui=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));let parentLink=null,setupRequired=false,currentList='',pendingRemove=null;
function token(){try{return localStorage.getItem('kidsParentToken')||sessionStorage.getItem('kidsParentToken')||'';}catch(_){return '';}}
function storeToken(value,remember){try{localStorage.removeItem('kidsParentToken');sessionStorage.removeItem('kidsParentToken');(remember?localStorage:sessionStorage).setItem('kidsParentToken',value);}catch(_){}}
function clearToken(){try{localStorage.removeItem('kidsParentToken');sessionStorage.removeItem('kidsParentToken');}catch(_){}}
async function api(action,options={}){const headers={'Content-Type':'application/json',...(options.auth&&token()?{Authorization:'Bearer '+token()}:{})};const r=await fetch(API+'?action='+encodeURIComponent(action),{method:options.method||'GET',headers,body:options.body?JSON.stringify(options.body):undefined});const data=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(data.error||'FAILED'),{status:r.status});return data;}
function entries(raw){const out=[];for(const line of String(raw||'').replace(/^\uFEFF/,'').split(/\r?\n/)){const v=line.trim();if(!v||v.startsWith('//'))continue;const parts=v.split(/\s+\/\//,2);try{const link=KidsParentLinks.classify(parts[0]);out.push({...link,note:(parts[1]||'').trim()});}catch(_){out.push({url:parts[0],kind:'unknown',note:(parts[1]||'').trim()});}}return out;}
function renderList(raw){currentList=String(raw||'');ui['approved-text'].value=currentList;ui['approved-cards'].replaceChildren();const list=entries(currentList);if(!list.length){const p=document.createElement('p');p.textContent='אין עדיין קישורים מאושרים.';ui['approved-cards'].append(p);return;}for(const item of list){const box=document.createElement('article');box.className='entry';const title=document.createElement('p');title.className='entry-title';title.textContent=item.note||(item.kind==='channel'?'ערוץ YouTube':'סרטון YouTube');const link=document.createElement('p');link.className='entry-link';link.textContent=item.url;const remove=document.createElement('button');remove.type='button';remove.className='remove';remove.textContent='הסר';remove.addEventListener('click',()=>askRemove(item));box.append(title,link,remove);ui['approved-cards'].append(box);}}
function showParent(list){ui.auth.hidden=true;ui['parent-area'].hidden=false;renderList(list||'');setParentView(false);}
function setParentView(catalog){
  ui['management-view'].hidden=catalog;ui['catalog-view'].hidden=!catalog;
  ui['management-tab'].setAttribute('aria-selected',String(!catalog));ui['management-tab'].setAttribute('aria-pressed',String(!catalog));
  ui['catalog-tab'].setAttribute('aria-selected',String(catalog));ui['catalog-tab'].setAttribute('aria-pressed',String(catalog));
  ui['management-tab'].classList.toggle('secondary',catalog);ui['catalog-tab'].classList.toggle('secondary',!catalog);
  if(catalog&&!ui['parent-catalog'].src)ui['parent-catalog'].src='./index.html?parentCatalog=1';
}
async function loadList(){const d=await api('list');setupRequired=!!d.setupRequired;renderList(d.list);return d;}
async function boot(){try{const d=await loadList();if(token()){try{const s=await api('status',{method:'POST',auth:true});if(s.authenticated){showParent(d.list);return;}}catch(_){}clearToken();}ui['auth-title'].textContent=setupRequired?'הגדרת סיסמה':'כניסת הורה';ui['auth-help'].textContent=setupRequired?'בחרו עכשיו סיסמה. מהכניסה הבאה האתר יזכור את ההורה במכשיר אם תסמנו ״זכור אותי״.':'הזינו את הסיסמה המשפחתית.';}catch(_){ui['auth-status'].textContent='לא הצלחנו להתחבר כרגע. נסו שוב.';}}
ui.login.addEventListener('click',async()=>{ui.login.disabled=true;ui['auth-status'].textContent='';try{const password=ui.password.value;if(password.length<4){ui['auth-status'].textContent='הסיסמה צריכה להכיל לפחות 4 תווים.';return;}const d=await api(setupRequired?'setup':'login',{method:'POST',body:{password,remember:ui.remember.checked}});storeToken(d.token,ui.remember.checked);const list=await loadList();ui.password.value='';showParent(list.list);}catch(e){ui['auth-status'].textContent=e.message==='WRONG_PASSWORD'?'סיסמה שגויה.':'הכניסה לא הצליחה. נסו שוב.';}finally{ui.login.disabled=false;}});
function resetPreview(){parentLink=null;ui.status.classList.remove('exists');ui.save.textContent='הוסף לרשימה';ui.save.disabled=false;ui.preview.hidden=true;ui['youtube-player'].hidden=true;ui['youtube-player'].removeAttribute('src');ui['channel-symbol'].hidden=true;}
ui.link.addEventListener('input',resetPreview);
ui.inspect.addEventListener('click',async()=>{resetPreview();ui.inspect.disabled=true;ui.status.textContent='טוען את פרטי התוכן…';try{parentLink=KidsParentLinks.share(ui.link.value);const meta=await api('metadata',{method:'POST',auth:true,body:{link:parentLink.url}});parentLink={...parentLink,...meta};const channel=parentLink.kind==='channel';ui.kind.textContent=channel?'📺 ערוץ שלם':'▶ סרטון אחד';ui['media-title'].textContent=parentLink.title||(channel?'ערוץ YouTube':'סרטון YouTube');ui['media-author'].textContent=parentLink.author||'';ui['media-author'].hidden=!parentLink.author;ui.canonical.textContent=parentLink.url;ui.note.value=parentLink.title||'';
const existing=entries(currentList).find(item=>item.url===parentLink.url);
ui.status.classList.toggle('exists',!!existing);
if(existing){
  ui.status.textContent='כבר קיים ברשימה'+(existing.note?' — '+existing.note:'')+'.';
  ui.save.textContent='כבר קיים ברשימה';ui.save.disabled=true;
}else{
  ui.status.textContent='הפרטים נטענו. אפשר להוסיף לרשימה.';
  ui.save.textContent='הוסף לרשימה';ui.save.disabled=false;
}ui['channel-warning'].hidden=!channel;ui['channel-symbol'].hidden=!channel;if(!channel&&parentLink.id){ui['youtube-player'].src='https://www.youtube.com/embed/'+encodeURIComponent(parentLink.id)+'?playsinline=1&rel=0';ui['youtube-player'].hidden=false;}ui.preview.hidden=false;}catch(e){if(e.status===401){clearToken();location.reload();return;}ui.status.textContent='לא הצלחנו לטעון את הקישור. ודאו שזה קישור של סרטון או ערוץ YouTube.';}finally{ui.inspect.disabled=false;}});
ui.save.addEventListener('click',async()=>{if(!parentLink)return;ui.save.disabled=true;ui.status.textContent='שומר…';try{const d=await api('mutate',{method:'POST',auth:true,body:{operation:'add',link:parentLink.url,note:ui.note.value}});renderList(d.list);ui.status.textContent=d.changed?'נוסף לרשימה ✓':'הקישור כבר נמצא ברשימה.';ui.link.value='';ui.note.value='';resetPreview();}catch(e){if(e.status===401){clearToken();location.reload();return;}ui.status.textContent='השמירה לא הצליחה. נסו שוב.';}finally{ui.save.disabled=false;}});
function setListMode(manual){ui['manual-editor'].hidden=!manual;ui['approved-cards'].hidden=manual;ui['manual-mode'].classList.toggle('secondary',!manual);ui['cards-mode'].classList.toggle('secondary',manual);}
ui['cards-mode'].addEventListener('click',()=>setListMode(false));ui['manual-mode'].addEventListener('click',()=>setListMode(true));
ui['save-list'].addEventListener('click',async()=>{ui['save-list'].disabled=true;ui['list-status'].textContent='שומר את הרשימה…';try{const d=await api('replace',{method:'POST',auth:true,body:{list:ui['approved-text'].value}});renderList(d.list);setListMode(false);ui['list-status'].textContent=d.changed?'הרשימה נשמרה ✓':'לא היו שינויים ברשימה.';}catch(e){if(e.status===401){clearToken();location.reload();return;}ui['list-status'].textContent=e.message==='INVALID_LIST'?'יש ברשימה קישור לא תקין. תקנו אותו ונסו שוב.':'שמירת הרשימה נכשלה. נסו שוב.';}finally{ui['save-list'].disabled=false;}});
function askRemove(item){pendingRemove=item;ui['remove-name'].textContent=item.note||(item.kind==='channel'?'ערוץ YouTube':'סרטון YouTube');ui['remove-link'].textContent=item.url;if(typeof ui['remove-dialog'].showModal==='function')ui['remove-dialog'].showModal();else if(confirm('להסיר את '+ui['remove-name'].textContent+' מהרשימה?'))removePending();}
function closeRemove(){pendingRemove=null;if(ui['remove-dialog'].open)ui['remove-dialog'].close();}
async function removePending(){if(!pendingRemove)return;const item=pendingRemove;ui['confirm-remove'].disabled=true;try{const d=await api('mutate',{method:'POST',auth:true,body:{operation:'remove',link:item.url,note:''}});renderList(d.list);ui['list-status'].textContent=d.changed?'הפריט הוסר ✓':'הפריט כבר לא נמצא ברשימה.';closeRemove();}catch(e){if(e.status===401){clearToken();location.reload();return;}ui['list-status'].textContent='ההסרה נכשלה. נסו שוב.';}finally{ui['confirm-remove'].disabled=false;}}
ui['cancel-remove'].addEventListener('click',closeRemove);ui['confirm-remove'].addEventListener('click',removePending);
ui['refresh-list'].addEventListener('click',()=>loadList().then(()=>{ui['list-status'].textContent='הרשימה עודכנה.';}).catch(()=>{ui['list-status'].textContent='הרענון נכשל.';}));
ui['management-tab'].addEventListener('click',()=>setParentView(false));
ui['catalog-tab'].addEventListener('click',()=>setParentView(true));
window.addEventListener('message',event=>{
  if(ui['parent-area'].hidden||event.origin!==location.origin||event.source!==ui['parent-catalog'].contentWindow)return;
  const data=event.data;if(!data||data.type!=='kids-parent-open-video'||!/^[A-Za-z0-9_-]{11}$/.test(data.id))return;
  ui['catalog-player-title'].textContent=typeof data.title==='string'&&data.title.trim()?data.title.slice(0,300):'צפייה בסרטון';
  ui['catalog-player'].src='https://www.youtube.com/embed/'+encodeURIComponent(data.id)+'?playsinline=1&rel=0&autoplay=1';
  if(typeof ui['catalog-player-dialog'].showModal==='function')ui['catalog-player-dialog'].showModal();
});
function closeCatalogPlayer(){ui['catalog-player'].removeAttribute('src');if(ui['catalog-player-dialog'].open)ui['catalog-player-dialog'].close();}
ui['catalog-player-close'].addEventListener('click',closeCatalogPlayer);
ui['catalog-player-dialog'].addEventListener('close',()=>ui['catalog-player'].removeAttribute('src'));
ui.logout.addEventListener('click',()=>{clearToken();location.reload();});
boot();
