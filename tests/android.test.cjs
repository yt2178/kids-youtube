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
test('native packaging accepts Windows line endings at its checked anchors',()=>{
  const {once}=require('../android/prepare-assets.cjs');
  assert.equal(once('first\r\nsecond\r\n','first\nsecond','replaced'),'replaced\n');
});
test('native bundle parses and keeps the three-tab UI without changing website source',()=>{
  const {prepare}=require('../android/prepare-assets.cjs'),out=fs.mkdtempSync(path.join(os.tmpdir(),'kids-native-'));
  try {
    const original=fs.readFileSync(path.join(root,'app.js'),'utf8');
    const {html,app}=prepare(out);
    new vm.Script(app);new vm.Script(adapter);
    assert.match(html,/id="videos-tab"/);assert.match(html,/id="channels-tab"/);assert.match(html,/id="all-tab"/);
    assert.match(html,/frame-src 'none'/);assert.match(html,/false && 'serviceWorker'/);
    assert.match(app,/const providers = KidsNative.createManager\(\)/);
    assert.match(app,/KidsNative.openPlayer\(id,video.title\)/);
    assert.equal(fs.readFileSync(path.join(root,'app.js'),'utf8'),original);
  }finally{fs.rmSync(out,{recursive:true,force:true});}
});
test('native CSP allows only the production Kids Supabase origin for connections',()=>{
  const {prepare}=require('../android/prepare-assets.cjs'),out=fs.mkdtempSync(path.join(os.tmpdir(),'kids-csp-'));
  try{
    const {html}=prepare(out);
    const metas=[...html.matchAll(/<meta id="app-csp" http-equiv="Content-Security-Policy" content="([^"]+)">/g)];
    assert.equal(metas.length,1);
    const csp=metas[0][1];
    assert.match(csp,/connect-src 'self' https:\/\/jxhelpxhrmwvzrrfrjuh\.supabase\.co(?:;|$)/);
    assert.doesNotMatch(csp,/connect-src[^;]*\*/);
    assert.doesNotMatch(csp,/connect-src[^;]*https:\/\/[^ ;]*supabase\.co[^ ;]*\*/);
    assert.doesNotMatch(csp,/unsafe-eval/);assert.doesNotMatch(csp,/invidious|chocolatemoo/);assert.match(csp,/media-src 'none'/);assert.match(csp,/worker-src 'none'/);
  }finally{fs.rmSync(out,{recursive:true,force:true});}
});
test('native WebView allows only the exact Kids Supabase function as a remote API request',()=>{
  const source=fs.readFileSync(path.join(root,'android/app/src/main/java/il/kidsyoutube/MainActivity.java'),'utf8');
  assert.doesNotMatch(source,/static final String SUPABASE_HOST/);
  assert.match(source,/SUPABASE_PATH="\/functions\/v1\/kids-youtube"/);
  assert.match(source,/effectiveSupabaseHost\.equals\(h\)/);
  assert.match(source,/effectiveSupabaseHost=Uri\.parse\(getString\(R\.string\.kids_backend_url\)\)\.getHost\(\)/);
  assert.match(source,/SUPABASE_PATH\.equals\(u\.getPath\(\)\)/);
  assert.match(source,/!request\.isForMainFrame\(\)/);
  assert.doesNotMatch(source,/supabase\.co.*endsWith/);
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
test('native adapter no longer intercepts a static videos.txt fallback',()=>{
  assert.doesNotMatch(adapter,/videos\.txt|method:'whitelist'/);
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
test('native authorization fails closed, persists no approval snapshot, and playback rechecks the parent list',()=>{
  const source=fs.readFileSync(path.join(root,'android/app/src/main/java/il/kidsyoutube/NativeApi.java'),'utf8');
  assert.match(source,/String displayWhitelist\(\) throws Exception \{[\s\S]*return whitelist\(true\);/);
  const playback=source.slice(source.indexOf('Playback playback(String id)'));
  assert.ok((playback.match(/whitelist\(true\)/g)||[]).length>=2);
  assert.doesNotMatch(source,/getSharedPreferences|native-list|putString\("display"/);
});
test('native player shows a real loading indicator until playback is ready or fails',()=>{
  const source=fs.readFileSync(path.join(root,'android/app/src/main/java/il/kidsyoutube/MainActivity.java'),'utf8');
  assert.match(source,/private ProgressBar loading/);assert.match(source,/loading=new ProgressBar/);
  assert.match(source,/showLoading\(true\).*showMessage\("מתחבר\.\.\."\)/s);
  assert.match(source,/STATE_READY[\s\S]{0,300}showLoading\(false\)/);
  assert.match(source,/unavailable\(\)[\s\S]{0,300}showLoading\(false\)/);
});

test('native activity restricts messages to the packaged main frame and stops media',()=>{
  const source=fs.readFileSync(path.join(root,'android/app/src/main/java/il/kidsyoutube/MainActivity.java'),'utf8');
  assert.match(source,/!isMainFrame/);assert.match(source,/Set.of\(ORIGIN\)/);
  assert.doesNotMatch(source,/\.addJavascriptInterface\(/);
  assert.match(source,/generation!=playerGeneration/);assert.match(source,/player\.release\(\)/);
  assert.match(source,/setShowNextButton\(false\)/);
  assert.match(source,/handleDeepLink\(getIntent\(\)\)/);assert.match(source,/ApprovalPolicy\.VIDEO\.matcher\(id\)/);
  const manifest=fs.readFileSync(path.join(root,'android/app/src/main/AndroidManifest.xml'),'utf8');
  assert.match(manifest,/android:scheme="kidsyoutube"/);
  assert.match(source,/getString\(R\.string\.kids_deep_link_scheme\)\.equals\(data\.getScheme\(\)\)/);assert.match(manifest,/android:host="video"/);assert.match(manifest,/android.intent.category.BROWSABLE/);
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


test('native bridge forwards known card title but never treats it as playback approval',async()=>{
  const {c,messages,reply}=context();
  const promise=c.KidsNative.openPlayer('mVTlbvQ_010','ילד טרמפולינה');
  assert.equal(messages[0].method,'play');
  assert.equal(messages[0].argument.id,'mVTlbvQ_010');
  assert.equal(messages[0].argument.title,'ילד טרמפולינה');
  reply({id:messages[0].id,data:true});await promise;
  const native=fs.readFileSync(path.join(root,'android/app/src/main/java/il/kidsyoutube/MainActivity.java'),'utf8');
  assert.match(native,/openPlayer\(video,videoTitle\)/);
  assert.match(native,/result\.title/);
  assert.match(native,/KidsPlayback/);
});
test('native channel pin requires exact current parent-list membership',()=>{
  const source=fs.readFileSync(path.join(root,'android/app/src/main/java/il/kidsyoutube/NativeApi.java'),'utf8');
  assert.match(source,/next\.channelUrls\.contains\(url\)/);
  assert.match(source,/aliases\.clear\(\);aliases\.putAll\(pinned\)/);
  assert.match(source,/whitelist\(true\)/);
  assert.match(fs.readFileSync(path.join(root,'android/app/build.gradle'),'utf8'),/format=native/);
});
