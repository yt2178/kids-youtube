// Separate experimental parent portal; never reads legacy approvals.
'use strict';
const BASE='https://jxhelpxhrmwvzrrfrjuh.supabase.co';
const KEY='sb_publishable_DBqKHRzGSVN0YvvXVS6w4g_-dv416mu';
const els=Object.fromEntries(['login-area','setup-area','editor-area','email','password','login','family-name','enroll','approvals','save','refresh','logout','status','pairing-area','create-code','pair-code','pair-expires','devices-area','refresh-devices','device-list','age-packs-area','age-band','age-pack-count','refresh-age-packs','apply-age-pack'].map(id=>[id,document.getElementById(id)]));
let token='',version=0,busy=false;
let agePacks=Object.create(null);
function status(t){els.status.textContent=t;}
function view(part){els['login-area'].hidden=part!=='login';els['setup-area'].hidden=part!=='setup';els['editor-area'].hidden=part!=='editor';els.logout.hidden=part==='login';els['pairing-area'].hidden=part!=='editor';els['devices-area'].hidden=part!=='editor';els['age-packs-area'].hidden=part!=='editor';if(part!=='editor'){els['pair-code'].textContent='';els['pair-expires'].textContent='';}}
function loading(on){busy=on;for(const key of ['login','enroll','save','refresh','create-code','refresh-devices','refresh-age-packs'])els[key].disabled=on;const items=agePacks[els['age-band'].value];els['apply-age-pack'].disabled=on||!Array.isArray(items)||items.length===0;}
async function request(path,body,access){
 const c=new AbortController(),timeout=setTimeout(()=>c.abort(),15000);
 try{
  const r=await fetch(BASE+path,{method:body===undefined?'GET':'POST',headers:{apikey:KEY,...(access?{Authorization:'Bearer '+access}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:c.signal});
  const d=await r.json();
  if(!r.ok)throw Object.assign(Error(d?.error_description||d?.error||d?.msg||'REQUEST_FAILED'),{httpStatus:r.status});
  return d;
 }finally{clearTimeout(timeout);}
}
async function getList(){
 try{const d=await request('/functions/v1/kids-youtube-family?action=list',undefined,token);version=d.version;els.approvals.value=d.list;view('editor');status('הרשימה הניסיונית נטענה.');await refreshDevices().catch(()=>{status('הרשימה נטענה, אך לא ניתן להציג את המכשירים כרגע.');});await refreshAgePacks().catch(()=>{status('הרשימה נטענה, אך ספריות הגיל אינן זמינות כרגע.');});}
 catch(e){if(e.httpStatus===403&&e.message==='NO_FAMILY'){view('setup');status('אין עדיין משפחת ניסוי לחשבון זה. ההרשמה מוגבלת להזמנות מאושרות.');}else throw e;}
}
async function guarded(fn){if(busy)return;loading(true);try{await fn();}catch(e){if(e.httpStatus===401){token='';version=0;els.approvals.value='';els.password.value='';view('login');}status(e.name==='AbortError'?'הבקשה ארכה זמן רב מדי.':e.loginRejected?'לא ניתן להתחבר. בדקו את פרטי הכניסה ואימות כתובת הדוא״ל.':e.httpStatus===401?'ההתחברות פגה. בצעו כניסה מחדש.':e.message==='ENROLLMENT_CLOSED'?'הרשמת משפחות חדשה עדיין סגורה; אין שינוי בחשבון.':e.message==='INVITATION_REQUIRED'?'אין הזמנה מאושרת לחשבון זה.':'הפעולה נכשלה: '+e.message);}finally{loading(false);}}
els.login.addEventListener('click',()=>guarded(async()=>{
 status('מתחבר…');const email=els.email.value.trim(),password=els.password.value;
 if(!email||!password){status('הזינו כתובת דוא״ל וסיסמה.');return;}
 let d;try{d=await request('/auth/v1/token?grant_type=password',{email,password});}
 catch(e){if(e.httpStatus===400||e.httpStatus===401)e.loginRejected=true;throw e;}
 if(typeof d.access_token!=='string')throw Error('TOKEN_MISSING');
 token=d.access_token;els.password.value='';await getList();
}));
els.enroll.addEventListener('click',()=>guarded(async()=>{
 const name=els['family-name'].value.trim();if(!name){status('יש להזין שם משפחה.');return;}
 if(!confirm('ליצור משפחה ניסיונית חדשה עם רשימת אישורים ריקה, ללא שינוי ברשימה הרגילה?'))return;
 await request('/functions/v1/kids-youtube-family?action=enroll',{name},token);
 await getList();
}));
els.save.addEventListener('click',()=>guarded(async()=>{
 if(!Number.isSafeInteger(version)||version<1)throw Error('VERSION_REQUIRED');
 if(!confirm('לעדכן את רשימת האישורים של המשפחה הניסיונית?'))return;
 const d=await request('/functions/v1/kids-youtube-family?action=replace',{list:els.approvals.value,expectedVersion:version},token);
 version=d.version;els.approvals.value=d.list;status('הרשימה הניסיונית נשמרה.');
}));
els.refresh.addEventListener('click',()=>guarded(getList));
async function refreshDevices(){
 const data=await request('/functions/v1/kids-youtube-family?action=devices',undefined,token);
 if(!Array.isArray(data.devices))throw Error('INVALID_DEVICES');
 const box=els['device-list'];box.replaceChildren();
 if(!data.devices.length){const p=document.createElement('p');p.textContent='עדיין אין מכשירים משויכים.';box.append(p);return;}
 for(const device of data.devices){
  const item=document.createElement('div');item.setAttribute('role','listitem');
  item.style.borderBottom='1px solid #5b5471';item.style.padding='10px 0';
  const name=document.createElement('span');
  name.textContent=(typeof device.name==='string'?device.name:'מכשיר')+
    (device.revoked_at?' — ההרשאה בוטלה':' — מחובר');
  item.append(name);
  if(!device.revoked_at&&typeof device.id==='string'){
   const button=document.createElement('button');button.type='button';
   button.textContent='בטל הרשאה למכשיר זה';
   button.addEventListener('click',()=>guarded(async()=>{
    if(!confirm('לבטל למכשיר זה גישה לרשימת המשפחה? לא ניתן לבטל פעולה זו מתוך המכשיר.'))return;
    await request('/functions/v1/kids-youtube-family?action=revoke-device',{deviceId:device.id},token);
    status('הרשאת המכשיר בוטלה.');await refreshDevices();
   }));
   item.append(button);
  }
  box.append(item);
 }
}
els['refresh-devices'].addEventListener('click',()=>guarded(refreshDevices));
function renderAgePack(){
 const age=els['age-band'].value;
 const items=agePacks[age];
 const count=Array.isArray(items)?items.length:0;
 els['age-pack-count'].textContent=count===0?'עדיין אין סרטונים שעברו בדיקה לספרייה הזאת. לא ניתן להחיל אותה.':'נבדקו ואושרו '+count+' סרטונים בקבוצת הגיל '+age+'.';
 els['apply-age-pack'].disabled=busy||count===0;
}
async function refreshAgePacks(){
 const result=await request('/functions/v1/kids-youtube-family?action=age-packs',undefined,token);
 if(!result.packs||typeof result.packs!=='object')throw Error('INVALID_AGE_PACKS');
 agePacks=result.packs;
 renderAgePack();
}
els['age-band'].addEventListener('change',renderAgePack);
els['refresh-age-packs'].addEventListener('click',()=>guarded(refreshAgePacks));
els['apply-age-pack'].addEventListener('click',()=>guarded(async()=>{
 const age=els['age-band'].value,items=agePacks[age];
 if(!Array.isArray(items)||!items.length||version<1)throw Error('PACK_UNAVAILABLE');
 if(!confirm('להחליף את כל רשימת האישורים של משפחת הניסוי בספריית גיל '+age+'? ההחלפה אינה משנה את המערכת המשפחתית הרגילה.'))return;
 const result=await request('/functions/v1/kids-youtube-family?action=apply-age-pack',
  {age,expectedVersion:version},token);
 if(typeof result.list!=='string'||!Number.isSafeInteger(result.version))throw Error('INVALID_PACK_RESPONSE');
 version=result.version;els.approvals.value=result.list;
 status('הספרייה שנבדקה לגילאי '+age+' הוחלה על משפחת הניסוי.');
}));
els['create-code'].addEventListener('click',()=>guarded(async()=>{
 const d=await request('/functions/v1/kids-youtube-family?action=create-code',{},token);
 if(typeof d.code!=='string'||!/^[A-Za-z0-9_-]{16}$/.test(d.code))throw Error('INVALID_PAIR_CODE');
 els['pair-code'].textContent=d.code;
 els['pair-expires'].textContent='בתוקף עד: '+new Date(d.expiresAt).toLocaleTimeString('he-IL');
 status('קוד השיוך נוצר. שתפו אותו רק עם המכשיר שאליו אתם מתכוונים לשייך.');
}));
els.logout.addEventListener('click',()=>guarded(async()=>{
 const prior=token;
 token='';version=0;els.approvals.value='';els.password.value='';view('login');
 try{if(prior)await request('/auth/v1/logout',{},prior);status('יצאת מהמערכת הניסיונית.');}
 catch(e){status('המידע המקומי נוקה. לא ניתן לאשר ניתוק מהשרת; מומלץ לסגור את הדפדפן.');}
}));
window.addEventListener('pagehide',()=>{token='';version=0;});
view('login');
