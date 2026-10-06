/* SPDX-License-Identifier: GPL-3.0-or-later */
'use strict';
const parentUI=Object.fromEntries(['link','inspect','status','preview','kind','thumbnail','channel-symbol','identified','canonical','verify','operation','note','checked','save','channel-warning'].map(id=>[id,document.getElementById(id)]));
let parentLink=null;
function resetParentPreview(){parentLink=null;parentUI.preview.hidden=true;parentUI.checked.checked=false;parentUI.save.disabled=true;parentUI.thumbnail.removeAttribute('src');}
parentUI.link.addEventListener('input',resetParentPreview);
parentUI.inspect.addEventListener('click',()=>{
  resetParentPreview();
  try{
    parentLink=KidsParentLinks.share(parentUI.link.value);const channel=parentLink.kind==='channel';
    parentUI.kind.textContent=channel?'📺 ערוץ שלם':'▶ סרטון אחד';
    parentUI.identified.textContent=channel?'הערוץ: '+parentLink.label:'סרטון מזוהה לפי הקישור. פתחו אותו ובדקו את שמו והתוכן.';
    parentUI.canonical.textContent=parentLink.url;parentUI.verify.href=parentLink.url;
    parentUI.thumbnail.hidden=channel;parentUI['channel-symbol'].hidden=!channel;
    if(!channel)parentUI.thumbnail.src='https://img.youtube.com/vi/'+parentLink.id+'/hqdefault.jpg';
    parentUI['channel-warning'].hidden=!channel;
    parentUI.preview.hidden=false;parentUI.status.textContent='הקישור זוהה. בדקו את התוכן לפני אישור.';
  }catch(_){parentUI.status.textContent='הדביקו קישור אחד של סרטון או ערוץ YouTube.';}
});
parentUI.thumbnail.addEventListener('error',()=>{parentUI.thumbnail.hidden=true;});
parentUI.checked.addEventListener('change',()=>{parentUI.save.disabled=!parentLink||!parentUI.checked.checked;});
parentUI.operation.addEventListener('change',()=>{parentUI.checked.checked=false;parentUI.save.disabled=true;});
parentUI.save.addEventListener('click',()=>{
  if(!parentLink||!parentUI.checked.checked)return;
  location.assign(KidsParentLinks.issueURL(parentLink.url,parentUI.operation.value,parentUI.note.value));
});

