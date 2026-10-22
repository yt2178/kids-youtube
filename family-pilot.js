// Separate experimental parent portal; never reads legacy approvals.
'use strict';
const BASE='https://jxhelpxhrmwvzrrfrjuh.supabase.co';
const KEY='sb_publishable_DBqKHRzGSVN0YvvXVS6w4g_-dv416mu';
const els=Object.fromEntries(['login-area','setup-area','editor-area','email','password','login','family-name','enroll','approvals','save','refresh','logout','status','pairing-area','create-code','pair-code','pair-expires','devices-area','refresh-devices','device-list'].map(id=>[id,document.getElementById(id)]));
let token='',version=0,busy=false;
function status(t){els.status.textContent=t;}
function view(part){els['login-area'].hidden=part!=='login';els['setup-area'].hidden=part!=='setup';els['editor-area'].hidden=part!=='editor';els.logout.hidden=part==='login';els['pairing-area'].hidden=part!=='editor';els['devices-area'].hidden=part!=='editor';if(part!=='editor'){els['pair-code'].textContent='';els['pair-expires'].textContent='';}}
function loading(on){busy=on;for(const key of ['login','enroll','save','refresh','create-code','refresh-devices'])els[key].disabled=on;}
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
 try{const d=await request('/functions/v1/kids-youtube-family?action=list',undefined,token);version=d.version;els.approvals.value=d.list;view('editor');status('הרשימה הניסיונית נטענה.');await refreshDevices().catch(()=>{status('הרשימה נטענה, אך לא ניתן להציג את המכשירים כרגע.');});}
 catch(e){if(e.httpStatus===403||e.httpStatus===404){view('setup');status('עדיין לא נוצרה רשימת אישורים עבור החשבון.');}else throw e;}
}
async function guarded(fn){if(busy)return;loading(true);try{await fn();}catch(e){status(e.name==='AbortError'?'הבקשה ארכה זמן רב מדי.':e.httpStatus===401?'ההתחברות פגה. בצעו כניסה מחדש.':'הפעולה נכשלה: '+e.message);}finally{loading(false);}}
els.login.addEventListener('click',()=>guarded(async()=>{
 status('מתחבר…');const email=els.email.value.trim(),password=els.password.value;
 if(!email||!password){status('הזינו כתובת דוא״ל וסיסמה.');return;}
 const d=await request('/auth/v1/token?grant_type=password',{email,password});
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
els['create-code'].addEventListener('click',()=>guarded(async()=>{
 const d=await request('/functions/v1/kids-youtube-family?action=create-code',{},token);
 if(typeof d.code!=='string'||!/^[A-Za-z0-9_-]{16}$/.test(d.code))throw Error('INVALID_PAIR_CODE');
 els['pair-code'].textContent=d.code;
 els['pair-expires'].textContent='בתוקף עד: '+new Date(d.expiresAt).toLocaleTimeString('he-IL');
 status('קוד השיוך נוצר. שתפו אותו רק עם המכשיר שאליו אתם מתכוונים לשייך.');
}));
els.logout.addEventListener('click',()=>{token='';version=0;els.approvals.value='';els.password.value='';view('login');status('יצאת מהמערכת הניסיונית.');});
window.addEventListener('pagehide',()=>{token='';version=0;});
view('login');
