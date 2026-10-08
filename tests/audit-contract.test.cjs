const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
const app=read('app.js'),html=read('index.html'),sw=read('sw.js'),parents=read('parents.html'),parentJs=read('parents.js');
const edge=read('supabase/functions/kids-youtube/index.ts');
const native=read('android/app/src/main/java/il/kidsyoutube/NativeApi.java');
const policy=read('android/app/src/main/java/il/kidsyoutube/ApprovalPolicy.java');
const activity=read('android/app/src/main/java/il/kidsyoutube/MainActivity.java');

test('authorization source is live Supabase only and stale browser cache cannot become a grant',()=>{
  assert.match(app,/const PARENT_API = 'https:\/\/jxhelpxhrmwvzrrfrjuh\.supabase\.co\/functions\/v1\/kids-youtube'/);
  assert.match(app,/return fetchJson\(PARENT_API\+'\?action=list'\)/);
  assert.match(app,/fetchAuthorization\('load'\)/);
  assert.match(app,/window\.KidsNative\.fetchAuthorization\(\{loadCycle,requestId,source\}\)/);
  assert.match(native,/JSONObject displayAuthorization\(\)/);
  assert.match(edge,/const response=\{list:s\.list_text,version:s\.version,updatedAt:s\.updated_at,catalogVersion:1/);
  assert.match(edge,/pinnedChannels:pins/);
  assert.match(edge,/latest\.version!==s\.version\|\|latest\.updated_at!==s\.updated_at\|\|latest\.list_text!==s\.list_text/);
  assert.doesNotMatch(app,/fetchText\('\.\/videos\.txt'|fetch\(['"]\.\/videos\.txt/);
  assert.match(app,/activeConfig=\{videos:\[\],channels:\[\]\};activeLists=Object\.create\(null\);displayed=new Map\(\)/);
  assert.match(app,/failClosedAuthorization/);
  assert.doesNotMatch(sw,/action=list|functions\/v1\/kids-youtube|videos\.txt/);
  assert.doesNotMatch(app,/indexedDB/i);
});

test('parent catalog cannot contact Invidious directly and cannot be enabled by a cross-origin frame',()=>{
  assert.match(app,/sameOriginParent\(\)/);
  assert.match(app,/if\(!INVIDIOUS_INSTANCES\.includes\(target\.origin\)\)throw new Error\('INVALID_PARENT_PROVIDER'\)/);
  assert.match(app,/PARENT_API\+'\?action=provider&target='/);
  assert.match(app,/connect-src 'self' https:\/\/jxhelpxhrmwvzrrfrjuh\.supabase\.co/);
  assert.doesNotMatch(parents,/connect-src[^;]*invidious|connect-src[^;]*chocolatemoo/);
});

test('proxy is authenticated, exact-host/path limited, bounded and does not follow arbitrary redirects',()=>{
  assert.match(edge,/PROVIDER_ORIGINS\.has\(u\.origin\)/);
  assert.match(edge,/if\(!await auth\(req,s\)\)return json\(\{error:"UNAUTHORIZED"\},401,origin\)/);
  assert.match(edge,/PROVIDER_TIMEOUT_MS = 3500/);assert.match(edge,/MAX_PROVIDER_BYTES = 2000000/);
  assert.doesNotMatch(edge,/u\.pathname==="\/api\/v1\/stats"/);
  assert.doesNotMatch(edge,/startsWith\("\/api\/v1\/"\)/);
  assert.match(edge,/redirect:"manual"/);
  assert.match(edge,/safeYoutubePage/);
});

test('native playback remains fail-closed with fresh checks before and after extraction',()=>{
  const playback=native.slice(native.indexOf('Playback playback(String id)'));
  assert.ok((playback.match(/whitelist\(true\)/g)||[]).length>=2);
  assert.doesNotMatch(native,/native-list|getSharedPreferences/);
  assert.match(policy,/googlevideo\.com/);assert.match(policy,/u\.getRawUserInfo\(\)==null/);
  assert.match(activity,/kidsyoutube/);assert.match(activity,/ApprovalPolicy\.VIDEO\.matcher\(id\)\.matches\(\)\)openPlayer\(id,/);
});

test('parent UI keeps official YouTube iframe, exact requested label and no external-open button',()=>{
  assert.match(parents,/שם הסרטון\/הערוץ\/הערה אחרת \(לא חובה\)/);
  assert.match(parents,/https:\/\/www\.youtube\.com/);
  assert.doesNotMatch(parents,/פתח ב־YouTube|id="verify"/);
  assert.match(parentJs,/youtube\.com\/embed/);
});

test('cache-bust version and service-worker shell version are audited together',()=>{
  const appVersion=(html.match(/app\.js\?v=([^"']+)/)||[])[1];
  assert.ok(appVersion);assert.match(sw,new RegExp("app\\.js\\?v="+appVersion.replace(/[.*+?^$()|[\]\\]/g,'\\$&')));
  assert.match(sw,/SHELL_CACHE = CACHE_PREFIX \+ 'v25'/);
});


test('legacy videos.txt is not deployed or packaged as an authorization fallback',()=>{
  const pages=read('.github/workflows/pages.yml'),androidReadme=read('android/README.md');
  assert.doesNotMatch(pages,/cp[^\n]*videos\.txt/);
  assert.doesNotMatch(app,/fetch[^\n]*videos\.txt/);assert.doesNotMatch(sw,/videos\.txt/);
  assert.match(androidReadme,/אינו מקור ההרשאה הפעיל/);
});
