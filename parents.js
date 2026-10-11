/* SPDX-License-Identifier: GPL-3.0-or-later */
'use strict';
const API='https://jxhelpxhrmwvzrrfrjuh.supabase.co/functions/v1/kids-youtube';
const PARENT_REQUEST_TIMEOUT_MS=20000, CHANNEL_IMAGE_TIMEOUT_MS=8000; // no automatic retry of parent writes
const ids=['management-search-toggle','management-search-panel','search-query','search-submit','search-status','search-results','search-more','auth','auth-title','auth-help','auth-spinner','password','remember','login','auth-status','parent-area','link','inspect','status','preview','kind','media-title','media-author','youtube-player-shell','youtube-player-loading','youtube-player','channel-image-loading','channel-image','channel-symbol','canonical','note','save','channel-warning','approved-cards','approved-text','manual-editor','cards-mode','manual-mode','save-list','list-status','refresh-list','management-tab','catalog-tab','management-view','catalog-view','parent-catalog','parent-catalog-loading','catalog-player-dialog','catalog-player-title','catalog-player-loading','catalog-player','catalog-player-close','logout','remove-dialog','remove-name','remove-link','cancel-remove','confirm-remove'];
const ui=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));let parentLink=null,setupRequired=false,currentList='',currentVersion=null,manualVersion=null,pendingRemove=null,channelImageTimer=null,channelImageDeadline=null,previewGeneration=0,sessionEpoch=0,listSequence=0;let catalogSupported=false,catalogBackfillStarted=false;const pendingRequests=new Set();
const TRUSTED_FRAME=window.top===window;
function token(){try{return localStorage.getItem('kidsParentToken')||sessionStorage.getItem('kidsParentToken')||'';}catch(_){return '';}}
function storeToken(value,remember){try{localStorage.removeItem('kidsParentToken');sessionStorage.removeItem('kidsParentToken');(remember?localStorage:sessionStorage).setItem('kidsParentToken',value);}catch(_){}}
function clearToken(){try{localStorage.removeItem('kidsParentToken');sessionStorage.removeItem('kidsParentToken');}catch(_){}}
function expireSession(){sessionEpoch++;previewGeneration++;listSequence++;for(const controller of pendingRequests)controller.abort();pendingRequests.clear();clearToken();}
function setBusy(button,on){
  if(!button)return;clearTimeout(button._busyTimer);button._busyTimer=null;button.classList.remove('busy');
  button.setAttribute('aria-busy',String(!!on));button.disabled=!!on;
  if(on)button._busyTimer=setTimeout(()=>{button._busyTimer=null;if(button.disabled)button.classList.add('busy');},180);
}
function safeChannelImage(value){try{const u=new URL(value);const ok=['img.youtube.com','i.ytimg.com','yt3.ggpht.com','yt3.googleusercontent.com'].includes(u.hostname.toLowerCase());return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&ok?u.href:'';}catch(_){return '';}}
function startFrame(shell,frame,loader,src){shell.hidden=false;loader.hidden=false;frame.src=src;}
async function api(action,options={}){
  const method=options.method||'GET',headers={...(options.auth&&token()?{Authorization:'Bearer '+token()}:{})};
  const body=options.body?JSON.stringify(options.body):undefined;if(body)headers['Content-Type']='application/json';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),PARENT_REQUEST_TIMEOUT_MS);
  pendingRequests.add(controller);
  try{
    const r=await fetch(action==='search'?'https://jxhelpxhrmwvzrrfrjuh.supabase.co/functions/v1/kids-youtube-search':API+'?action='+encodeURIComponent(action),{method,headers,body,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
    let data;
    try{data=await r.json();}catch(error){if(controller.signal.aborted)throw Error('TIMEOUT');throw Error('BAD_RESPONSE');}
    if(controller.signal.aborted)throw Error('TIMEOUT');
    if(!data||typeof data!=='object'||Array.isArray(data))throw Error('BAD_RESPONSE');
    if(!r.ok)throw Object.assign(Error(data.error||'FAILED'),{status:r.status});return data;
  }catch(error){
    if(controller.signal.aborted||error&&error.name==='AbortError')throw Error('TIMEOUT');
    throw error;
  }finally{clearTimeout(timer);pendingRequests.delete(controller);}
}
function entries(raw){const out=[];for(const line of String(raw||'').replace(/^\uFEFF/,'').split(/\r?\n/)){const v=line.trim();if(!v||v.startsWith('//'))continue;const parts=v.split(/\s+\/\//,2);try{const link=KidsParentLinks.classify(parts[0]);out.push({...link,note:(parts[1]||'').trim()});}catch(_){out.push({url:parts[0],kind:'unknown',note:(parts[1]||'').trim()});}}return out;}
function renderList(raw,version){currentList=String(raw||'');syncSearchButtons();if(Number.isSafeInteger(version))currentVersion=version;if(ui['manual-editor'].hidden)ui['approved-text'].value=currentList;ui['approved-cards'].replaceChildren();const list=entries(currentList);if(!list.length){const p=document.createElement('p');p.textContent='אין עדיין קישורים מאושרים.';ui['approved-cards'].append(p);return;}for(const item of list){const box=document.createElement('article');box.className='entry';const title=document.createElement('p');title.className='entry-title';title.textContent=item.note||(item.kind==='channel'?'ערוץ YouTube':'סרטון YouTube');const link=document.createElement('p');link.className='entry-link';link.textContent=item.url;const remove=document.createElement('button');remove.type='button';remove.className='remove';remove.textContent='הסר';remove.addEventListener('click',()=>askRemove(item));box.append(title,link,remove);ui['approved-cards'].append(box);}}
async function backfillApprovedCatalog(){
  if(!catalogSupported||catalogBackfillStarted||!token())return;
  catalogBackfillStarted=true;
  const epoch=sessionEpoch;
  // No Edge Function work is left running after its response. At most two
  // synchronous preparation requests per parent visit; no cron or polling.
  for(let i=0;i<2&&epoch===sessionEpoch&&!document.hidden;i++){
    try{
      const data=await api('catalog');
      if(epoch!==sessionEpoch||!Array.isArray(data.entries))return;
      const byUrl=new Map(data.entries.filter(x=>x&&typeof x.approval_url==='string').map(x=>[x.approval_url,x]));
      const item=entries(currentList).find(e=>{
        const row=byUrl.get(e.url);
        return !row||(!row.complete&&(!row.continuation||Number(row.pages_loaded)<8));
      });
      if(!item)return;
      const row=byUrl.get(item.url);
      const continuation=row&&!row.complete&&row.continuation&&Date.now()-Date.parse(row.checked_at)<4*60*1000?row.continuation:null;
      await api('prepare',{method:'POST',auth:true,body:{link:item.url,continuation}});
    }catch{return;} // Aborted/auth-expired/provider failure is not a grant.
  }
}
function showParent(list){ui.auth.hidden=true;ui['parent-area'].hidden=false;renderList(list||'');setParentView(false);if(catalogSupported)Promise.resolve().then(backfillApprovedCatalog);}
function setParentView(catalog){
  ui['management-search-toggle'].hidden=catalog;
  if(catalog){
    ui['management-search-panel'].hidden=true;
    ui['management-search-toggle'].setAttribute('aria-expanded','false');
    // Invalidates search results arriving after leaving the screen.
    searchGeneration++;
    setBusy(ui['search-submit'],false);
    ui['search-more'].disabled=false;
  }
  // A late metadata response must not recreate a hidden preview behind the catalog.
  if(catalog&&ui.inspect.disabled)resetPreview();
  ui['management-view'].hidden=catalog;ui['catalog-view'].hidden=!catalog;
  ui['management-tab'].setAttribute('aria-selected',String(!catalog));ui['management-tab'].setAttribute('aria-pressed',String(!catalog));
  ui['catalog-tab'].setAttribute('aria-selected',String(catalog));ui['catalog-tab'].setAttribute('aria-pressed',String(catalog));
  ui['management-tab'].classList.toggle('secondary',catalog);ui['catalog-tab'].classList.toggle('secondary',!catalog);
  if(catalog){
    if(ui['youtube-player'].src){ui['youtube-player'].removeAttribute('src');ui['youtube-player-loading'].hidden=true;}
    if(!ui['parent-catalog'].src){ui['parent-catalog-loading'].hidden=false;ui['parent-catalog'].src='./index.html?parentCatalog=1';}
  }else{
    if(ui['parent-catalog'].src){ui['parent-catalog'].removeAttribute('src');ui['parent-catalog-loading'].hidden=true;}
    if(ui['catalog-player-dialog'].open)closeCatalogPlayer();
    if(parentLink&&parentLink.kind==='video'&&parentLink.id&&!ui.preview.hidden&&!ui['youtube-player'].src)
      startFrame(ui['youtube-player-shell'],ui['youtube-player'],ui['youtube-player-loading'],'https://www.youtube.com/embed/'+encodeURIComponent(parentLink.id)+'?playsinline=1&rel=0');
  }
}
async function loadList(){const seq=++listSequence,epoch=sessionEpoch;const d=await api('list');if(seq!==listSequence||epoch!==sessionEpoch)return null;setupRequired=!!d.setupRequired;catalogSupported=d.catalogVersion===1;renderList(d.list,d.version);return d;}
async function boot(){const epoch=sessionEpoch;const bootSpinner=setTimeout(()=>{ui['auth-spinner'].hidden=false;},180);try{const d=await loadList();if(epoch!==sessionEpoch||!d)return;if(token()){try{const s=await api('status',{method:'POST',auth:true});if(epoch!==sessionEpoch)return;if(s.authenticated){showParent(d.list);return;}}catch(_){}if(epoch!==sessionEpoch)return;clearToken();}ui['auth-title'].textContent=setupRequired?'הגדרת סיסמה':'כניסת הורה';ui['auth-help'].textContent=setupRequired?'בחרו עכשיו סיסמה. מהכניסה הבאה האתר יזכור את ההורה במכשיר אם תסמנו ״זכור אותי״.':'הזינו את הסיסמה המשפחתית.';}catch(_){ui['auth-status'].textContent='לא הצלחנו להתחבר כרגע. נסו שוב.';}finally{clearTimeout(bootSpinner);ui['auth-spinner'].hidden=true;}}
ui.login.addEventListener('click',async()=>{if(ui.login.disabled)return;const epoch=sessionEpoch;setBusy(ui.login,true);ui['auth-status'].textContent='';try{const password=ui.password.value;if(password.length<4){ui['auth-status'].textContent='הסיסמה צריכה להכיל לפחות 4 תווים.';return;}const d=await api(setupRequired?'setup':'login',{method:'POST',body:{password,remember:ui.remember.checked}});if(epoch!==sessionEpoch)return;storeToken(d.token,ui.remember.checked);const list=await loadList();if(epoch!==sessionEpoch||!list)return;ui.password.value='';showParent(list.list);}catch(e){ui['auth-status'].textContent=e.message==='WRONG_PASSWORD'?'סיסמה שגויה.':'הכניסה לא הצליחה. נסו שוב.';}finally{setBusy(ui.login,false);}});
function resetPreview(){previewGeneration++;clearTimeout(channelImageTimer);clearTimeout(channelImageDeadline);channelImageTimer=null;channelImageDeadline=null;parentLink=null;ui.status.classList.remove('exists');ui.save.textContent='הוסף לרשימה';ui.save.disabled=false;ui.preview.hidden=true;ui['youtube-player-shell'].hidden=true;ui['youtube-player-loading'].hidden=true;ui['youtube-player'].removeAttribute('src');ui['channel-image-loading'].hidden=true;ui['channel-image'].hidden=true;ui['channel-image'].removeAttribute('src');ui['channel-symbol'].hidden=true;}
ui.link.addEventListener('input',resetPreview);
ui.inspect.addEventListener('click',async()=>{if(ui.inspect.disabled)return;resetPreview();const generation=previewGeneration,epoch=sessionEpoch;setBusy(ui.inspect,true);ui.status.textContent='טוען את פרטי התוכן…';try{const link=KidsParentLinks.share(ui.link.value);const meta=await api('metadata',{method:'POST',auth:true,body:{link:link.url}});if(generation!==previewGeneration||epoch!==sessionEpoch)return;parentLink={...link,...meta};const channel=parentLink.kind==='channel';ui.kind.textContent=channel?'ערוץ שלם':'סרטון אחד';ui['media-title'].textContent=parentLink.title||(channel?'ערוץ YouTube':'סרטון YouTube');ui['media-author'].textContent=parentLink.author||'';ui['media-author'].hidden=!parentLink.author;ui.canonical.textContent=parentLink.url;ui.note.value=parentLink.title||'';
const existing=entries(currentList).find(item=>item.url===parentLink.url);
ui.status.classList.toggle('exists',!!existing);
if(existing){
  ui.status.textContent='כבר קיים ברשימה'+(existing.note?' — '+existing.note:'')+'.';
  ui.save.textContent='כבר קיים ברשימה';ui.save.disabled=true;
}else{
  ui.status.textContent='הפרטים נטענו. אפשר להוסיף לרשימה.';
  ui.save.textContent='הוסף לרשימה';ui.save.disabled=false;
}ui['channel-warning'].hidden=!channel;
if(channel){
  const image=safeChannelImage(parentLink.thumbnail||'');
  if(image){
    ui['channel-image-loading'].hidden=true;ui['channel-image'].hidden=true;ui['channel-symbol'].hidden=true;
    channelImageTimer=setTimeout(()=>{channelImageTimer=null;if(ui['channel-image'].hidden&&ui['channel-image'].src)ui['channel-image-loading'].hidden=false;},180);
    channelImageDeadline=setTimeout(()=>{channelImageDeadline=null;clearTimeout(channelImageTimer);channelImageTimer=null;ui['channel-image-loading'].hidden=true;ui['channel-image'].hidden=true;ui['channel-image'].removeAttribute('src');ui['channel-symbol'].hidden=false;},CHANNEL_IMAGE_TIMEOUT_MS);
    ui['channel-image'].src=image;
  }else{
    ui['channel-image-loading'].hidden=true;ui['channel-image'].hidden=true;ui['channel-symbol'].hidden=false;
  }
}else if(parentLink.id){
  startFrame(ui['youtube-player-shell'],ui['youtube-player'],ui['youtube-player-loading'],'https://www.youtube.com/embed/'+encodeURIComponent(parentLink.id)+'?playsinline=1&rel=0');
}
ui.preview.hidden=false;}catch(e){if(generation!==previewGeneration||epoch!==sessionEpoch)return;if(e.status===401){expireSession();location.reload();return;}ui.status.textContent='לא הצלחנו לטעון את הקישור. ודאו שזה קישור של סרטון או ערוץ YouTube.';}finally{setBusy(ui.inspect,false);}});
ui.save.addEventListener('click',async()=>{if(!parentLink||ui.save.disabled)return;const item=parentLink,generation=previewGeneration,epoch=sessionEpoch,note=ui.note.value;setBusy(ui.save,true);ui.status.textContent='שומר…';try{const d=await api('mutate',{method:'POST',auth:true,body:{operation:'add',link:item.url,note}});if(epoch!==sessionEpoch)return;listSequence++;renderList(d.list,d.version);if(generation!==previewGeneration)return;ui.status.textContent=d.changed?'נוסף לרשימה ✓':'הקישור כבר נמצא ברשימה.';ui.link.value='';ui.note.value='';resetPreview();}catch(e){if(epoch!==sessionEpoch||generation!==previewGeneration)return;if(e.status===401){expireSession();location.reload();return;}ui.status.textContent='השמירה לא הצליחה. נסו שוב.';}finally{if(ui.save.textContent!=='כבר קיים ברשימה')setBusy(ui.save,false);}});
function setListMode(manual){if(manual&&ui['manual-editor'].hidden){ui['approved-text'].value=currentList;manualVersion=currentVersion;}ui['manual-editor'].hidden=!manual;ui['approved-cards'].hidden=manual;ui['manual-mode'].classList.toggle('secondary',!manual);ui['cards-mode'].classList.toggle('secondary',manual);}
ui['cards-mode'].addEventListener('click',()=>setListMode(false));ui['manual-mode'].addEventListener('click',()=>setListMode(true));
ui['save-list'].addEventListener('click',async()=>{if(ui['save-list'].disabled)return;const epoch=sessionEpoch;if(!Number.isSafeInteger(manualVersion)){ui['list-status'].textContent='יש לרענן את הרשימה לפני עריכה.';return;}setBusy(ui['save-list'],true);ui['list-status'].textContent='שומר את הרשימה…';try{const d=await api('replace',{method:'POST',auth:true,body:{list:ui['approved-text'].value,expectedVersion:manualVersion}});if(epoch!==sessionEpoch)return;listSequence++;setListMode(false);renderList(d.list,d.version);ui['list-status'].textContent=d.changed?'הרשימה נשמרה ✓':'לא היו שינויים ברשימה.';}catch(e){if(epoch!==sessionEpoch)return;if(e.status===401){expireSession();location.reload();return;}ui['list-status'].textContent=e.status===409?'הרשימה השתנתה במכשיר אחר. העריכה שלך לא נשמרה. העתיקו אותה לפני רענון ובדקו את השינויים.':e.message==='INVALID_LIST'?'יש ברשימה קישור לא תקין. תקנו אותו ונסו שוב.':'שמירת הרשימה נכשלה. נסו שוב.';}finally{setBusy(ui['save-list'],false);}});
function askRemove(item){pendingRemove=item;ui['remove-name'].textContent=item.note||(item.kind==='channel'?'ערוץ YouTube':'סרטון YouTube');ui['remove-link'].textContent=item.url;if(typeof ui['remove-dialog'].showModal==='function')ui['remove-dialog'].showModal();else if(confirm('להסיר את '+ui['remove-name'].textContent+' מהרשימה?'))removePending();}
function closeRemove(){pendingRemove=null;if(ui['remove-dialog'].open)ui['remove-dialog'].close();}
async function removePending(){if(!pendingRemove||ui['confirm-remove'].disabled)return;const epoch=sessionEpoch,item=pendingRemove;setBusy(ui['confirm-remove'],true);try{const d=await api('mutate',{method:'POST',auth:true,body:{operation:'remove',link:item.url,note:''}});if(epoch!==sessionEpoch)return;listSequence++;renderList(d.list,d.version);ui['list-status'].textContent=d.changed?'הפריט הוסר ✓':'הפריט כבר לא נמצא ברשימה.';closeRemove();}catch(e){if(epoch!==sessionEpoch)return;if(e.status===401){expireSession();location.reload();return;}ui['list-status'].textContent='ההסרה נכשלה. נסו שוב.';}finally{setBusy(ui['confirm-remove'],false);}}
ui['cancel-remove'].addEventListener('click',closeRemove);ui['confirm-remove'].addEventListener('click',removePending);
ui['refresh-list'].addEventListener('click',async()=>{setBusy(ui['refresh-list'],true);ui['list-status'].textContent='מרענן את הרשימה…';try{await loadList();ui['list-status'].textContent='הרשימה עודכנה.';}catch(_){ui['list-status'].textContent='הרענון נכשל.';}finally{setBusy(ui['refresh-list'],false);}});
ui['management-tab'].addEventListener('click',()=>setParentView(false));
ui['catalog-tab'].addEventListener('click',()=>setParentView(true));
window.addEventListener('message',event=>{
  if(ui['parent-area'].hidden||event.origin!==location.origin||event.source!==ui['parent-catalog'].contentWindow)return;
  const data=event.data;
  if(data&&data.type==='kids-parent-auth-expired'){clearToken();ui['parent-catalog'].removeAttribute('src');location.reload();return;}
  if(!data||data.type!=='kids-parent-open-video'||!/^[A-Za-z0-9_-]{11}$/.test(data.id))return;
  ui['catalog-player-title'].textContent=typeof data.title==='string'&&data.title.trim()?data.title.slice(0,300):'צפייה בסרטון';
  ui['catalog-player-loading'].hidden=false;ui['catalog-player'].src='https://www.youtube.com/embed/'+encodeURIComponent(data.id)+'?playsinline=1&rel=0&autoplay=1';
  if(typeof ui['catalog-player-dialog'].showModal==='function')ui['catalog-player-dialog'].showModal();
});
function closeCatalogPlayer(){ui['catalog-player'].removeAttribute('src');ui['catalog-player-loading'].hidden=true;if(ui['catalog-player-dialog'].open)ui['catalog-player-dialog'].close();}
ui['catalog-player-close'].addEventListener('click',closeCatalogPlayer);
ui['catalog-player-dialog'].addEventListener('close',()=>ui['catalog-player'].removeAttribute('src'));
ui['youtube-player'].addEventListener('load',()=>{ui['youtube-player-loading'].hidden=true;});
ui['parent-catalog'].addEventListener('load',()=>{ui['parent-catalog-loading'].hidden=true;});
ui['catalog-player'].addEventListener('load',()=>{ui['catalog-player-loading'].hidden=true;});
ui['channel-image'].addEventListener('load',()=>{clearTimeout(channelImageTimer);clearTimeout(channelImageDeadline);channelImageTimer=null;channelImageDeadline=null;ui['channel-image-loading'].hidden=true;ui['channel-image'].hidden=false;ui['channel-symbol'].hidden=true;});
ui['channel-image'].addEventListener('error',()=>{clearTimeout(channelImageTimer);clearTimeout(channelImageDeadline);channelImageTimer=null;channelImageDeadline=null;ui['channel-image-loading'].hidden=true;ui['channel-image'].hidden=true;ui['channel-image'].removeAttribute('src');ui['channel-symbol'].hidden=false;});
ui.logout.addEventListener('click',()=>{expireSession();ui['parent-catalog'].removeAttribute('src');ui['catalog-player'].removeAttribute('src');ui['youtube-player'].removeAttribute('src');location.reload();});

// Search is parent-only and never grants access until the parent explicitly adds a result.
let searchItems=[],searchQuery='',searchPage='',searchGeneration=0;
ui['management-search-toggle'].addEventListener('click',()=>{
  if(ui['management-view'].hidden)return;
  const opening=ui['management-search-panel'].hidden;
  ui['management-search-panel'].hidden=!opening;
  ui['management-search-toggle'].setAttribute('aria-expanded',String(opening));
  if(opening&&typeof ui['search-query'].focus==='function')ui['search-query'].focus();
  if(!opening){
    searchGeneration++; // Ignore late results after hiding search.
    setBusy(ui['search-submit'],false);
    ui['search-more'].disabled=false;
  }
});
const searchAdds=new Set(),searchButtons=new Map();
function searchKey(item){return item.kind+':'+item.id;}
function searchUrl(item){return item.kind==='channel'?'https://www.youtube.com/channel/'+item.id:'https://www.youtube.com/watch?v='+item.id;}
function syncSearchButtons(){
  const approved=new Set(entries(currentList).map(item=>item.url));
  for(const [key,button] of searchButtons){
    const item=searchItems.find(value=>searchKey(value)===key);
    if(!item)continue;
    const exists=approved.has(searchUrl(item)),busy=searchAdds.has(key);
    button.disabled=exists||busy;
    button.textContent=exists?'כבר מאושר':busy?'מוסיף…':item.kind==='channel'?'הוסף את כל הערוץ':'אישור הסרטון';
  }
}
function openSearchVideo(item){
  if(ui['parent-area'].hidden||!token()||!item||item.kind!=='video'||!/^[A-Za-z0-9_-]{11}$/.test(item.id))return;
  ui['catalog-player-title'].textContent=String(item.title||'צפייה בסרטון').slice(0,300);
  ui['catalog-player-loading'].hidden=false;
  ui['catalog-player'].src='https://www.youtube.com/embed/'+item.id+'?playsinline=1&rel=0&autoplay=1';
  if(typeof ui['catalog-player-dialog'].showModal==='function')ui['catalog-player-dialog'].showModal();
}
function previewSearchChannel(item){
  if(ui['parent-area'].hidden||!token()||!item||item.kind!=='channel'||!/^UC[A-Za-z0-9_-]{22}$/.test(item.id))return;
  resetPreview();
  parentLink={kind:'channel',id:item.id,url:searchUrl(item),title:item.title,thumbnail:item.thumbnail};
  ui.link.value=parentLink.url;ui.kind.textContent='ערוץ שלם';
  ui['media-title'].textContent=item.title;
  ui['media-author'].hidden=true;ui['media-author'].textContent='';
  ui.canonical.textContent=parentLink.url;ui.note.value=item.title;
  ui['channel-warning'].hidden=false;
  const approved=entries(currentList).find(value=>value.url===parentLink.url);
  ui.status.classList.toggle('exists',!!approved);
  ui.status.textContent=approved?'הערוץ כבר קיים ברשימת הילדים.':'בחירת ערוץ שלם: כל הסרטונים שלו וגם סרטונים עתידיים יהיו מותרים לילדים.';
  ui.save.disabled=!!approved;ui.save.textContent=approved?'כבר קיים ברשימה':'הוסף את כל הערוץ';
  const image=safeChannelImage(item.thumbnail);
  ui['channel-symbol'].hidden=!!image;
  if(image){
    ui['channel-image-loading'].hidden=true;ui['channel-image'].hidden=true;
    ui['channel-image'].src=image;
    channelImageDeadline=setTimeout(()=>{
      channelImageDeadline=null;ui['channel-image-loading'].hidden=true;
      ui['channel-image'].hidden=true;ui['channel-image'].removeAttribute('src');
      ui['channel-symbol'].hidden=false;
    },CHANNEL_IMAGE_TIMEOUT_MS);
  }
  ui.preview.hidden=false;
  if(typeof ui.preview.scrollIntoView==='function')ui.preview.scrollIntoView({behavior:'smooth',block:'start'});
}
let searchAvatarLookups=0;
async function resolveMissingSearchAvatar(item,image,fallback,generation){
  if(searchAvatarLookups>=3 || !token())return;
  searchAvatarLookups++;
  const epoch=sessionEpoch;
  try{
    const meta=await api('metadata',{method:'POST',auth:true,body:{link:searchUrl(item)}});
    if(epoch!==sessionEpoch||generation!==searchGeneration||!searchItems.includes(item))return;
    const src=safeChannelImage(meta.thumbnail);
    if(src){item.thumbnail=src;image.src=src;}
  }catch(_){/* An unavailable thumbnail is not a grant or a search failure. */}
}
function renderSearch(){
  ui['search-results'].replaceChildren();searchButtons.clear();
  for(const item of searchItems){
    const channel=item.kind==='channel',row=document.createElement('article');
    row.className='search-row'+(channel?' search-channel':'');
    const visual=document.createElement('div');visual.className='search-visual';
    if(channel){
      const fallback=document.createElement('span');fallback.className='search-avatar-fallback';fallback.textContent='ערוץ';
      visual.append(fallback);
      const src=safeChannelImage(item.thumbnail);
      // Reject explicit third-party image URLs entirely. For missing images
      // only, use a bounded authenticated metadata lookup as a fallback.
      if(src||!item.thumbnail){
        const image=document.createElement('img');image.alt='';image.className='search-avatar';image.referrerPolicy='no-referrer';
        image.addEventListener('load',()=>{fallback.hidden=true;image.hidden=false;});
        image.addEventListener('error',()=>{image.hidden=true;fallback.hidden=false;});
        image.hidden=true;visual.append(image);
        if(src)image.src=src;
        else resolveMissingSearchAvatar(item,image,fallback,searchGeneration);
      }
    }else{
      const image=document.createElement('img');image.src='https://i.ytimg.com/vi/'+item.id+'/mqdefault.jpg';
      image.alt='';image.loading='lazy';image.referrerPolicy='no-referrer';visual.append(image);
    }
    const info=document.createElement('div');info.className='search-info';
    const badge=document.createElement('p');badge.className='search-kind';badge.textContent=channel?'ערוץ שלם':'סרטון';
    const title=document.createElement('button');title.type='button';title.className='search-title-button';title.textContent=item.title;
    title.addEventListener('click',()=>channel?previewSearchChannel(item):openSearchVideo(item));
    const author=document.createElement('p');
    author.textContent=channel?'אישור הערוץ יאפשר את כל הסרטונים שלו, כולל חדשים בעתיד.':item.author;
    const actions=document.createElement('div');actions.className='search-actions';
    const open=document.createElement('button');open.type='button';open.className='secondary';
    open.textContent=channel?'פרטי הערוץ':'צפייה בסרטון';
    open.addEventListener('click',()=>channel?previewSearchChannel(item):openSearchVideo(item));
    const add=document.createElement('button');add.type='button';add.addEventListener('click',()=>addSearchResult(item));
    searchButtons.set(searchKey(item),add);
    actions.append(open,add);info.append(badge,title,author,actions);row.append(visual,info);ui['search-results'].append(row);
  }
  syncSearchButtons();ui['search-more'].hidden=!searchPage;
}
async function addSearchResult(item){
  if(ui['parent-area'].hidden||!token()||!item)return;
  const key=searchKey(item),url=searchUrl(item);
  if(searchAdds.has(key)||entries(currentList).some(e=>e.url===url))return;
  const epoch=sessionEpoch;searchAdds.add(key);syncSearchButtons();
  try{
    const d=await api('mutate',{method:'POST',auth:true,body:{operation:'add',link:url,note:item.title}});
    if(epoch!==sessionEpoch)return;listSequence++;renderList(d.list,d.version);
    ui['search-status'].textContent=d.changed?(item.kind==='channel'?'הערוץ השלם אושר לילדים ✓':'הסרטון אושר לילדים ✓'):'הפריט כבר נמצא ברשימה.';
  }catch(e){
    if(epoch!==sessionEpoch)return;if(e.status===401){expireSession();location.reload();return;}
    ui['search-status'].textContent='לא הצלחנו לשמור את האישור. נסו שוב.';
  }finally{searchAdds.delete(key);syncSearchButtons();}
}
async function runSearch(more=false){
  if(ui['parent-area'].hidden||ui['management-search-panel'].hidden||ui['search-submit'].disabled)return;
  const query=ui['search-query'].value.trim();if(!query){ui['search-status'].textContent='הקלידו מה לחפש.';return;}
  const append=more&&query===searchQuery;if(append&&!searchPage)return;
  const epoch=sessionEpoch,generation=++searchGeneration;
  if(!append){searchItems=[];searchPage='';searchQuery=query;searchAvatarLookups=0;renderSearch();}
  setBusy(ui['search-submit'],true);ui['search-more'].disabled=true;ui['search-status'].textContent='מחפש ערוצים וסרטונים ב־YouTube…';
  try{
    const d=await api('search',{method:'POST',auth:true,body:{query,pageToken:append?searchPage:''}});
    if(epoch!==sessionEpoch||generation!==searchGeneration)return;
    const found=Array.isArray(d.items)?d.items.filter(item=>{
      if(!item||!['video','channel'].includes(item.kind))return false;
      return item.kind==='channel'?/^UC[A-Za-z0-9_-]{22}$/.test(item.id):/^[A-Za-z0-9_-]{11}$/.test(item.id);
    }).map(item=>({kind:item.kind,id:item.id,title:String(item.title||(item.kind==='channel'?'ערוץ YouTube':'סרטון YouTube')).slice(0,300),author:String(item.author||'').slice(0,200),thumbnail:item.kind==='channel'?safeChannelImage(item.thumbnail):''})):[];
    const seen=new Set(searchItems.map(searchKey));for(const item of found){const key=searchKey(item);if(!seen.has(key)){seen.add(key);searchItems.push(item);}}
    // Rank the closest channel first and then its matching videos, rather
    // than interleaving that channel's videos with unrelated results.
    const normalized=value=>String(value||'').normalize('NFKC').trim().toLocaleLowerCase('he');
    const needle=normalized(query);
    const bestChannel=searchItems.filter(item=>item.kind==='channel')
      .sort((a,b)=>Number(normalized(b.title)===needle)-Number(normalized(a.title)===needle)
        || Number(normalized(b.title).includes(needle))-Number(normalized(a.title).includes(needle)))[0];
    const mainTitle=normalized(bestChannel?.title);
    const matchesMain=item=>item.kind==='video'&&!!mainTitle&&!!normalized(item.author)
      &&(normalized(item.author)===mainTitle||normalized(item.author).includes(needle)&&mainTitle.includes(needle));
    searchItems.sort((a,b)=>{
      const rank=item=>item===bestChannel?0:matchesMain(item)?1:item.kind==='channel'?2:3;
      return rank(a)-rank(b);
    });
    searchPage=typeof d.nextPageToken==='string'?d.nextPageToken:'';renderSearch();
    ui['search-status'].textContent=searchItems.length?
      (d.partial?'הוצגו תוצאות חלקיות. חלק ממקורות החיפוש אינם זמינים כרגע.':'ערוצים מוצגים ראשונים, ואחריהם סרטונים. בחרו מה לאשר לילדים.'):
      'לא נמצאו ערוצים או סרטונים. נסו חיפוש אחר.';
  }catch(e){
    if(epoch!==sessionEpoch||generation!==searchGeneration)return;if(e.status===401){expireSession();location.reload();return;}
    ui['search-status'].textContent='החיפוש אינו זמין כרגע. נסו שוב מאוחר יותר.';
  }finally{
    if(epoch===sessionEpoch&&generation===searchGeneration){
      setBusy(ui['search-submit'],false);ui['search-more'].disabled=false;
    }
  }
}
ui['search-submit'].addEventListener('click',()=>runSearch());
ui['search-more'].addEventListener('click',()=>runSearch(true));
ui['search-query'].addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();runSearch();}});

if(TRUSTED_FRAME)boot();else{
  ui['auth-spinner'].hidden=true;ui.login.disabled=true;
  ui['auth-status'].textContent='מטעמי אבטחה, יש לפתוח את אתר ההורים ישירות ולא מתוך אתר אחר.';
}
