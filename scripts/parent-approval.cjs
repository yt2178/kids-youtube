// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const links=require('../parent-links.js');
function parseRequest(body){
  if(typeof body!=='string'||body.length>12000)throw Error('INVALID_REQUEST');
  const fields=new Map();
  for(const chunk of body.split(/^### /m).slice(1)){
    const end=chunk.indexOf('\n');if(end<0)throw Error('INVALID_REQUEST');
    const key=chunk.slice(0,end).trim();if(fields.has(key))throw Error('DUPLICATE_FIELD');
    fields.set(key,chunk.slice(end+1).trim());
  }
  if(fields.size!==4||[...fields.keys()].some(k=>!['קישור','פעולה','הערה','בדיקה ואישור'].includes(k)))throw Error('INVALID_REQUEST');
  const link=links.classify(fields.get('קישור'));
  const action=fields.get('פעולה'),operation=action==='הוספה לרשימה'?'add':action==='ביטול אישור'?'remove':null;
  if(!operation||!/^\- \[[xX]\] בדקתי את הקישור ואת התוכן\. באישור ערוץ אני מאשר גם את הסרטונים החדשים שלו\.$/.test(fields.get('בדיקה ואישור')))throw Error('UNCONFIRMED');
  const note=fields.get('הערה');
  return {link:link.url,operation,note:note==='_No response_'?'':links.comment(note)};
}
async function authorized(github,repo,login){
  if(typeof login!=='string'||!/^[-a-zA-Z0-9]{1,39}$/.test(login))return false;
  try{const r=await github.rest.repos.getCollaboratorPermissionLevel({...repo,username:login});return ['admin','write','maintain'].includes(r.data.permission);}
  catch(_){return false;}
}
async function applyRequest(github,repo,request){
  for(let attempt=0;attempt<3;attempt++){
    const r=await github.rest.repos.getContent({...repo,path:'videos.txt',ref:'main'});
    const file=r.data;if(Array.isArray(file)||file.encoding!=='base64'||!/^[-a-f0-9]{40}$/.test(file.sha)||file.size>1000000)throw Error('INVALID_LIST');
    const raw=Buffer.from(file.content,'base64').toString('utf8'),updated=links.edit(raw,request);
    if(updated===raw)return {changed:false,sha:file.sha};
    try{
      const result=await github.rest.repos.createOrUpdateFileContents({...repo,path:'videos.txt',branch:'main',sha:file.sha,
        message:(request.operation==='add'?'Approve':'Revoke')+' content from verified parent request',
        content:Buffer.from(updated,'utf8').toString('base64')});
      return {changed:true,sha:result.data.commit.sha};
    }catch(e){if(e.status!==409||attempt===2)throw e;}
  }
}
async function processApproval({github,context}){
  const repo=context.repo,number=context.payload.issue?.number;
  if(!Number.isInteger(number)||repo.owner!=='yt2178'||repo.repo!=='kids-youtube')throw Error('INVALID_REPOSITORY');
  // Read the CURRENT issue: delayed opened/edited jobs cannot replay an older request.
  const {data:issue}=await github.rest.issues.get({...repo,issue_number:number});
  if(issue.state!=='open'||!issue.title.startsWith('[אישור הורה]')||issue.user.type!=='User')return {ignored:true};
  if(!await authorized(github,repo,issue.user.login)||!await authorized(github,repo,context.payload.sender?.login))return {unauthorized:true};
  let request;
  try{request=parseRequest(issue.body);}catch(_){
    await github.rest.issues.createComment({...repo,issue_number:number,body:'הבקשה לא נשמרה. מלאו קישור אחד, בחרו פעולה וסמנו את בדיקת התוכן.'});return {invalid:true};
  }
  const result=await applyRequest(github,repo,request);
  // GITHUB_TOKEN commits do not trigger Pages. Dispatch is essential, including a retry after a failed dispatch.
  await github.rest.actions.createWorkflowDispatch({...repo,workflow_id:'pages.yml',ref:'main'});
  const latest=(await github.rest.issues.get({...repo,issue_number:number})).data;
  if(latest.body!==issue.body||latest.title!==issue.title||latest.state!=='open')return {...result,superseded:true};
  await github.rest.issues.createComment({...repo,issue_number:number,body:request.operation==='add'
    ?'האישור נשמר ✓ אחרי שהפריסה מסתיימת, לחצו באפליקציית הילדים ״רענון הסרטונים״.'
    :'האישור בוטל ✓ אחרי הפריסה רעננו את אפליקציית הילדים. סרטון עדיין מותר אם הערוץ שלו מאושר בנפרד.'});
  await github.rest.issues.update({...repo,issue_number:number,state:'closed'});
  return result;
}
module.exports={parseRequest,authorized,applyRequest,processApproval};
