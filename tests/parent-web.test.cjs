const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const links=require('../parent-links.js'),api=require('../scripts/parent-approval.cjs');
const video='https://www.youtube.com/watch?v=mVTlbvQ_010',other='https://www.youtube.com/watch?v=AAAAAAAAAAA',channel='https://www.youtube.com/channel/UCV6xoqUxJzkWwCbDmEwMSYw';
function body(link=video,operation='הוספה לרשימה',note='_No response_'){return '### קישור\n\n'+link+'\n\n### פעולה\n\n'+operation+'\n\n### הערה\n\n'+note+'\n\n### בדיקה ואישור\n\n- [x] בדקתי את הקישור ואת התוכן. באישור ערוץ אני מאשר גם את הסרטונים החדשים שלו.';}
function mock({permission='write',raw='',conflicts=0,state='open',secondBody,dispatchFailure=false}={}){
  const calls=[],issue={state,title:'[אישור הורה] הוספה',body:body(),user:{type:'User',login:'parent'},number:9};let reads=0,gets=0;
  const github={rest:{
    repos:{
      getCollaboratorPermissionLevel:async r=>{calls.push(['permission',r]);return {data:{permission}};},
      getContent:async r=>{calls.push(['read',r]);reads++;return {data:{sha:(reads===1?'a':'b').repeat(40),encoding:'base64',size:raw.length,content:Buffer.from(raw).toString('base64')}};},
      createOrUpdateFileContents:async r=>{calls.push(['write',r]);if(conflicts-->0){raw=other+'\n';throw {status:409};}raw=Buffer.from(r.content,'base64').toString('utf8');return {data:{commit:{sha:'c'.repeat(40)}}};}
    },
    issues:{
      get:async r=>{calls.push(['issue',r]);gets++;return {data:{...issue,body:gets>1&&secondBody?secondBody:issue.body}};},
      createComment:async r=>{calls.push(['comment',r]);},
      update:async r=>{calls.push(['close',r]);issue.state=r.state;}
    },
    actions:{createWorkflowDispatch:async r=>{calls.push(['dispatch',r]);if(dispatchFailure)throw Error('network');}}
  }};
  const context={repo:{owner:'yt2178',repo:'kids-youtube'},payload:{issue:{number:9},sender:{login:'parent'}}};
  return {github,context,calls,issue,raw:()=>raw};
}
test('parent video share canonicalizes and deduplicates title plus equivalent links',()=>assert.equal(links.share('title '+video+' https://youtu.be/mVTlbvQ_010?si=x').url,video));
test('parent channel UC and Unicode handles identify as channels',()=>{assert.equal(links.share(channel).kind,'channel');assert.equal(links.classify('https://youtube.com/@ערוץ').kind,'channel');});
test('parent rejects multiple different video shares',()=>assert.throws(()=>links.share(video+' '+other)));
test('parent rejects malicious hosts, credentials, schemes, playlists and invalid IDs',()=>{
  for(const value of ['javascript:alert(1)','https://youtube.com.evil.test/watch?v=mVTlbvQ_010','https://x@youtube.com/watch?v=mVTlbvQ_010','https://youtube.com/playlist?list=1','https://youtu.be/invalid','https://youtube.com/@bad%2Fpath'])assert.throws(()=>links.classify(value));
});
test('parent issue URL pre-fills removal, link and safe single-line notes without executing them',()=>{
  const url=new URL(links.issueURL(video,'remove','hello\n'+other));
  assert.equal(url.origin,'https://github.com');assert.equal(url.pathname,'/yt2178/kids-youtube/issues/new');
  assert.equal(url.searchParams.get('operation'),'ביטול אישור');assert.equal(url.searchParams.get('link'),video);assert.ok(!url.searchParams.get('note').includes('\n'));
});
test('parent additions preserve notes and another parents existing approval',()=>{const raw='// note\n'+other;const out=links.edit(raw,{operation:'add',link:video,note:'test'});assert.ok(out.startsWith(raw));assert.equal(links.entries(out).length,2);});
test('parent duplicate input URL forms do not create duplicate approvals',()=>{const raw='https://youtu.be/mVTlbvQ_010 // known\n';assert.equal(links.edit(raw,{operation:'add',link:video}),raw);});
test('parent title/comment input cannot inject a second approval',()=>assert.equal(links.entries(links.edit('',{operation:'add',link:video,note:'\n'+other})).length,1));
test('revoking a video preserves channel and separate videos',()=>{const out=links.edit(video+'\n'+channel+'\n'+other,{operation:'remove',link:video});assert.equal(links.entries(out).length,2);assert.ok(out.includes(channel));});
test('revoking a channel preserves manual video approvals',()=>assert.equal(links.edit(channel+'\n'+video,{operation:'remove',link:channel}),video));
test('parent legacy JSON is never silently converted or overwritten',()=>assert.throws(()=>links.edit('\uFEFF{"videos":[]}',{operation:'add',link:video})));
test('issue body requires explicit content confirmation',()=>{assert.equal(api.parseRequest(body()).link,video);assert.throws(()=>api.parseRequest(body().replace('[x]','[ ]')));});
test('issue duplicate and injected fields fail closed',()=>assert.throws(()=>api.parseRequest(body()+'\n### קישור\n'+other)));
test('issue operation must be an exact supported value',()=>assert.throws(()=>api.parseRequest(body(video,'remove anything'))));
test('public users with read-only permissions cannot change or dispatch the whitelist',async()=>{const m=mock({permission:'read'});assert.equal((await api.processApproval(m)).unauthorized,true);assert.equal(m.calls.some(c=>['write','dispatch','close','comment'].includes(c[0])),false);});
test('a changed sender must independently have write permission',async()=>{const m=mock();m.context.payload.sender.login='intruder';m.github.rest.repos.getCollaboratorPermissionLevel=async r=>({data:{permission:r.username==='parent'?'write':'read'}});assert.equal((await api.processApproval(m)).unauthorized,true);assert.ok(!m.calls.some(c=>c[0]==='write'));});
test('successful parent request saves exactly videos.txt main and explicitly deploys Pages',async()=>{const m=mock();assert.equal((await api.processApproval(m)).changed,true);const write=m.calls.find(c=>c[0]==='write')[1];assert.equal(write.path,'videos.txt');assert.equal(write.branch,'main');assert.equal(write.sha,'a'.repeat(40));assert.equal(m.calls.find(c=>c[0]==='dispatch')[1].workflow_id,'pages.yml');assert.equal(m.issue.state,'closed');});
test('a SHA conflict rereads and preserves a concurrent parent approval',async()=>{const m=mock({conflicts:1});await api.processApproval(m);assert.ok(m.raw().includes(other));assert.ok(m.raw().includes(video));assert.equal(m.calls.filter(c=>c[0]==='write')[1][1].sha,'b'.repeat(40));});
test('conflict retries stop after three attempts',async()=>{const m=mock({conflicts:5});await assert.rejects(api.processApproval(m));assert.equal(m.calls.filter(c=>c[0]==='write').length,3);assert.ok(!m.calls.some(c=>c[0]==='close'));});
test('duplicate approvals still dispatch to recover from an earlier failed deployment',async()=>{const m=mock({raw:video});assert.equal((await api.processApproval(m)).changed,false);assert.ok(!m.calls.some(c=>c[0]==='write'));assert.ok(m.calls.some(c=>c[0]==='dispatch'));});
test('dispatch failure leaves the request open and never reports success',async()=>{const m=mock({dispatchFailure:true});await assert.rejects(api.processApproval(m));assert.equal(m.issue.state,'open');assert.ok(!m.calls.some(c=>c[0]==='comment'));});
test('closed or superseded issues cannot be replayed from an old event',async()=>{const m=mock({state:'closed'});assert.equal((await api.processApproval(m)).ignored,true);assert.ok(!m.calls.some(c=>c[0]==='write'));});
test('editing a request during its save does not close the newer request',async()=>{const m=mock({secondBody:body(other)});assert.equal((await api.processApproval(m)).superseded,true);assert.equal(m.issue.state,'open');});
test('invalid confirmed issue cannot add or deploy anything',async()=>{const m=mock();m.issue.body=body().replace('[x]','[ ]');assert.equal((await api.processApproval(m)).invalid,true);assert.ok(!m.calls.some(c=>['write','dispatch','close'].includes(c[0])));});
test('parent page uses password login, remembered session and direct server save without GitHub navigation',()=>{
  const html=fs.readFileSync('parents.html','utf8'),script=fs.readFileSync('parents.js','utf8');
  assert.match(html,/type="password"/);assert.match(html,/זכור אותי/);
  assert.match(script,/localStorage/);assert.match(script,/sessionStorage/);
  assert.match(script,/encodeURIComponent\(action\)/);assert.match(script,/mutate/);
  assert.doesNotMatch(script,/issueURL\(/);assert.doesNotMatch(html,/המשך לאישור ב־GitHub/);
});
