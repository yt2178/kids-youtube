// Packaging only: the deployed vanilla PWA remains unchanged.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..'), target = path.join(__dirname, 'app/build/generated/kidsAssets');
function once(text, needle, replacement) {
  text = text.replace(/\r\n/g,'\n');
  if (text.split(needle).length !== 2) throw new Error('Frontend adapter anchor changed: ' + needle.slice(0,60));
  return text.replace(needle, replacement);
}
function prepare(output = target) {
  fs.mkdirSync(output, {recursive:true});
  let html = fs.readFileSync(path.join(root,'index.html'),'utf8');
  html = once(html, "if ('serviceWorker' in navigator)", "if (false && 'serviceWorker' in navigator)");
  html = once(html, '<script src="./providers.js?v=20261006h" defer></script>', '<script src="./providers.js?v=20261006h" defer></script>\n  <script src="./native-adapter.js" defer></script>');
  let app = fs.readFileSync(path.join(root,'app.js'),'utf8');
  app = once(app, "function optionalStorage() { try { return localStorage; } catch (_) { return null; } }\nfunction parentToken(){try{return localStorage.getItem('kidsParentToken')||sessionStorage.getItem('kidsParentToken')||'';}catch(_){return '';}}\nasync function providerFetch(input,options={}) {\n  if(!PARENT_CATALOG){catalogMetrics.providerCalls++;return fetch(input,options);}\n  let target;try{target=new URL(String(input),location.href);}catch(_){throw new Error('INVALID_PARENT_PROVIDER');}\n  if(!INVIDIOUS_INSTANCES.includes(target.origin))throw new Error('INVALID_PARENT_PROVIDER');\n  const value=parentToken(),headers={...(options.headers||{}),...(value?{Authorization:'Bearer '+value}:{})};\n  catalogMetrics.providerCalls++;\n  const response=await fetch(PARENT_API+'?action=provider&target='+encodeURIComponent(target.href),{...options,headers});\n  if(response.status===401){\n    try{window.parent.postMessage({type:'kids-parent-auth-expired'},location.origin);}catch(_){}\n    return response;\n  }\n  const upstream=Number(response.headers.get('X-Kids-Provider-Status')||0);\n  if(upstream>=400&&upstream<=599){\n    const body=await response.text();\n    return new Response(body,{status:upstream,headers:{'Content-Type':'application/json'}});\n  }\n  return response;\n}\nconst providers = KidsProviders.createManager({instances:INVIDIOUS_INSTANCES, scope:SCOPE, fetcher:providerFetch, storage:optionalStorage(), timeout:SETTINGS.requestTimeoutMs, budget:SETTINGS.channelBudgetMs});", "function optionalStorage() { try { return localStorage; } catch (_) { return null; } }\nconst providers = KidsNative.createManager();
const nativeRequest = providers.request.bind(providers);
providers.request=(...args)=>{catalogMetrics.providerCalls++;return nativeRequest(...args);};");
  app = once(app, 'function openPlayer(id) {\n  const video = displayed.get(id);', "function openPlayer(id) {\n  const video = displayed.get(id);\n  if (video && (getApprovedVideos().has(id) || getApprovedChannels().has(video.channelId))) KidsNative.openPlayer(id,video.title);\n  return;\n  // Browser player remains in the source for website regression checks.");
  // No iframe, external scripts, or external document may run in the native WebView.
  html = once(html, '<meta id="app-csp" http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' https://img.youtube.com https://i.ytimg.com https://yt3.ggpht.com https://yt3.googleusercontent.com https://invidious.f5.si https://invidious.tiekoetter.com https://yt.chocolatemoo53.com; connect-src \'self\' https://jxhelpxhrmwvzrrfrjuh.supabase.co https://invidious.f5.si https://invidious.tiekoetter.com https://yt.chocolatemoo53.com; font-src \'self\'; media-src \'none\'; frame-src \'none\'; worker-src \'self\'; manifest-src \'self\'; object-src \'none\'; base-uri \'self\'; form-action \'none\'">', '<meta id="app-csp" http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' https://img.youtube.com https://i.ytimg.com https://yt3.ggpht.com https://yt3.googleusercontent.com; connect-src \'self\' https://jxhelpxhrmwvzrrfrjuh.supabase.co; font-src \'self\'; media-src \'none\'; frame-src \'none\'; worker-src \'none\'; manifest-src \'self\'; object-src \'none\'; base-uri \'self\'; form-action \'none\'">');
  fs.copyFileSync(path.join(__dirname,'LICENSE'),path.join(output,'LICENSE.txt'));
  fs.copyFileSync(path.join(__dirname,'THIRD_PARTY_NOTICES.md'),path.join(output,'THIRD_PARTY_NOTICES.txt'));
  fs.writeFileSync(path.join(output,'index.html'), html);
  fs.writeFileSync(path.join(output,'app.js'), app);
  fs.copyFileSync(path.join(__dirname,'native-adapter.js'),path.join(output,'native-adapter.js'));
  fs.copyFileSync(path.join(root,'providers.js'),path.join(output,'providers.js'));
  fs.copyFileSync(path.join(root,'manifest.json'),path.join(output,'manifest.json'));
  fs.cpSync(path.join(root,'icons'),path.join(output,'icons'),{recursive:true});
  fs.mkdirSync(path.join(__dirname,'app/build/generated/kidsRes/mipmap'),{recursive:true});
  fs.copyFileSync(path.join(root,'icons/icon-192.png'),path.join(__dirname,'app/build/generated/kidsRes/mipmap/ic_launcher.png'));
  return {html,app};
}
if (require.main === module) prepare();
module.exports = {prepare,once};
