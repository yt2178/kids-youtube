// Integration checks for Android packaging and its message transport. No browser automation.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),adapter=fs.readFileSync(path.join(root,'android/native-adapter.js'),'utf8');
function context() {
  const messages=[],bridge={postMessage:text=>messages.push(JSON.parse(text))};
  const c={window:null,KidsAndroid:bridge,location:{href:'https://appassets.androidplatform.net/assets/index.html'},
    document:{addEventListener:()=>{}},fetch:()=>Promise.reject(new Error('unexpected web network')),URL,Response,AbortController,setTimeout,clearTimeout,Map,WeakSet,Promise,JSON,Error};
  c.window=c;vm.createContext(c);vm.runInContext(adapter,c);
  return {c,messages,reply:(data)=>bridge.onmessage({data:JSON.stringify(data)})};
}
test('native bundle parses and keeps the three-tab UI without changing website source',()=>{
  const {prepare}=require('../android/prepare-assets.cjs'),out=fs.mkdtempSync(path.join(os.tmpdir(),'kids-native-'));
  try {
    const original=fs.readFileSync(path.join(root,'app.js'),'utf8');
    const {html,app}=prepare(out);
    new vm.Script(app);new vm.Script(adapter);
    assert.match(html,/id="videos-tab"/);assert.match(html,/id="channels-tab"/);assert.match(html,/id="all-tab"/);
    assert.match(html,/frame-src 'none'/);assert.match(html,/false && 'serviceWorker'/);
    assert.match(app,/const providers = KidsNative.createManager\(\)/);
    assert.match(app,/KidsNative.openPlayer\(id\)/);
    assert.equal(fs.readFileSync(path.join(root,'app.js'),'utf8'),original);
  }finally{fs.rmSync(out,{recursive:true,force:true});}
});
test('native transport resolves matching responses and validates metadata',async()=>{
  const {c,messages,reply}=context();
  const p=c.KidsNative.createManager().request('/api/v1/videos/mVTlbvQ_010',{validate:d=>d.videoId==='mVTlbvQ_010'});
  assert.equal(messages[0].method,'api');
  reply({id:messages[0].id,data:{videoId:'mVTlbvQ_010',title:'name'}});
  assert.equal((await p).title,'name');
});
test('native transport cancels abandoned requests and ignores late responses',async()=>{
  const {c,messages,reply}=context(),controller=new AbortController();
  const p=c.KidsNative.call('api','path',controller.signal);
  const rejection=assert.rejects(p,e=>e.code==='ABORTED');
  const old=messages[0].id;controller.abort();await rejection;
  assert.equal(messages[1].method,'cancel');
  const q=c.KidsNative.call('api','new');
  reply({id:old,data:{title:'old'}});
  reply({id:messages[2].id,data:{title:'new'}});
  assert.equal((await q).title,'new');
});
test('native transport has a finite deadline',async()=>{
  const {c,messages}=context();
  await assert.rejects(c.KidsNative.call('api','path',undefined,5),e=>e.code==='TIMEOUT');
  assert.equal(messages[1].method,'cancel');
});
test('manual whitelist uses the native authoritative read instead of Invidious',async()=>{
  const {c,messages,reply}=context();
  const p=c.fetch('./videos.txt',{cache:'no-store'});
  assert.equal(messages[0].method,'whitelist');
  reply({id:messages[0].id,data:'https://youtu.be/mVTlbvQ_010 // parent'});
  assert.match(await (await p).text(),/mVTlbvQ_010/);
});
test('native failures are rejected centrally without accepting invalid metadata',async()=>{
  const {c,messages,reply}=context(),manager=c.KidsNative.createManager();
  const p=manager.request('/api/v1/videos/mVTlbvQ_010');
  const rejection=assert.rejects(p,e=>e.code==='UPSTREAM_BLOCKED');
  reply({id:messages[0].id,error:'UPSTREAM_BLOCKED'});await rejection;
  const q=manager.request('next',{validate:()=>false});
  const invalid=assert.rejects(q,e=>e.code==='PROVIDER_ERROR');
  reply({id:messages[1].id,data:{bad:true}});await invalid;
});
test('native activity restricts messages to the packaged main frame and stops media',()=>{
  const source=fs.readFileSync(path.join(root,'android/app/src/main/java/il/kidsyoutube/MainActivity.java'),'utf8');
  assert.match(source,/!isMainFrame/);assert.match(source,/Set.of\(ORIGIN\)/);
  assert.doesNotMatch(source,/\.addJavascriptInterface\(/);
  assert.match(source,/generation!=playerGeneration/);assert.match(source,/player\.release\(\)/);
  assert.match(source,/setShowNextButton\(false\)/);
});

test('parent share target and credentials are isolated from the child app and packaged website',()=>{
  const child=fs.readFileSync(path.join(root,'android/app/src/main/AndroidManifest.xml'),'utf8');
  const parent=fs.readFileSync(path.join(root,'android/parent/src/main/AndroidManifest.xml'),'utf8');
  assert.doesNotMatch(child,/android.intent.action.SEND|ParentActivity/);
  assert.match(parent,/android.intent.action.SEND/);assert.match(parent,/android:mimeType="text\/plain"/);
  assert.match(parent,/android:allowBackup="false"/);assert.match(parent,/android:usesCleartextTraffic="false"/);
  const {prepare}=require('../android/prepare-assets.cjs'),out=fs.mkdtempSync(path.join(os.tmpdir(),'kids-parent-boundary-'));
  try{
    prepare(out);
    for(const file of fs.readdirSync(out).filter(x=>/\.(js|html)$/.test(x)))
      assert.doesNotMatch(fs.readFileSync(path.join(out,file),'utf8'),/github_pat_|TokenVault|Authorization.*Bearer/);
  }finally{fs.rmSync(out,{recursive:true,force:true});}
});
