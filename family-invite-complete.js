'use strict';
// Only a Supabase Auth invitation token in the URL fragment is accepted.
// Token is never saved in storage, printed, sent to analytics or appended to links.
const BASE='https://jxhelpxhrmwvzrrfrjuh.supabase.co';
const KEY='sb_publishable_DBqKHRzGSVN0YvvXVS6w4g_-dv416mu';
const statusEl=document.getElementById('status');
const area=document.getElementById('form-area');
const submit=document.getElementById('submit');
const pw=document.getElementById('new-password');
const confirmPw=document.getElementById('confirm-password');
let accessToken='';
function clearSensitive(){accessToken='';pw.value='';confirmPw.value='';area.hidden=true;}
async function authRequest(method,path,token,payload){
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetch(BASE+path,{method,headers:{apikey:KEY,Authorization:'Bearer '+token,...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
  if(!response.ok)throw Error('AUTH_REJECTED');
  return response.status===204?{}:await response.json();
 }finally{clearTimeout(timeout);}
}
async function initialize(){
 const fragment=location.hash.startsWith('#')?location.hash.slice(1):'';
 // Immediately remove all auth secrets from browser address bar and history.
 history.replaceState(null,'',location.pathname);
 const data=new URLSearchParams(fragment);
 const token=data.get('access_token'),type=data.get('type');
 if(type!=='invite'||!token||!/^[A-Za-z0-9._-]{20,4000}$/.test(token)||data.has('error')){
  statusEl.textContent='קישור ההזמנה אינו תקין או שפג תוקפו. בקשו קישור חדש ממנהל הניסוי.';
  return;
 }
 try{
  const user=await authRequest('GET','/auth/v1/user',token);
  if(!user||typeof user.id!=='string'||!user.email_confirmed_at||user.is_anonymous===true)
   throw Error('AUTH_REJECTED');
  accessToken=token;
  area.hidden=false;
  statusEl.textContent='הקישור אומת. בחרו סיסמה כדי להמשיך.';
 }catch(e){clearSensitive();statusEl.textContent='לא ניתן לאמת את ההזמנה. בקשו קישור חדש ממנהל הניסוי.';}
}
submit.addEventListener('click',async()=>{
 if(!accessToken)return;
 if(pw.value.length<12||pw.value.length>128||pw.value!==confirmPw.value){
  statusEl.textContent='בחרו סיסמה בת 12–128 תווים והזינו אותה באופן זהה בשני השדות.';return;
 }
 submit.disabled=true;
 try{
  await authRequest('PUT','/auth/v1/user',accessToken,{password:pw.value});
  clearSensitive();
  statusEl.textContent='הסיסמה נשמרה. כעת אפשר להיכנס לממשק ההורים עם הדוא״ל והסיסמה החדשה.';
 }catch(e){
  clearSensitive();statusEl.textContent='לא ניתן להשלים את קביעת הסיסמה. בקשו קישור הזמנה חדש.';
 }finally{submit.disabled=false;}
});
window.addEventListener('pagehide',clearSensitive);
initialize();