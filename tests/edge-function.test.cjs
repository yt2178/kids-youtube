const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('supabase/functions/kids-youtube/index.ts','utf8');

test('parent provider proxy is authenticated and restricted to exact configured origins and API paths',()=>{
  assert.match(source,/const PROVIDER_ORIGINS = new Set\(\[/);
  for(const origin of ['https://invidious.f5.si','https://invidious.tiekoetter.com','https://yt.chocolatemoo53.com'])assert.match(source,new RegExp(origin.replace(/[.]/g,'\\.')));
  assert.match(source,/action==="provider"/);assert.match(source,/if\(!await auth\(req,s\)\)return json\(\{error:"UNAUTHORIZED"\},401,origin\)/);
  assert.match(source,/PROVIDER_ORIGINS\.has\(u\.origin\)/);
  assert.match(source,/\/api\\\/v1\\\/videos/);assert.match(source,/\/api\\\/v1\\\/channels/);
  assert.match(source,/u\.pathname==="\/api\/v1\/resolveurl"/);assert.match(source,/u\.pathname==="\/api\/v1\/stats"/);
  assert.doesNotMatch(source,/proxyProvider[\s\S]{0,1600}redirect:"follow"/);
  assert.match(source,/PROVIDER_TIMEOUT_MS = 3500/);assert.match(source,/timed\(PROVIDER_TIMEOUT_MS/);
  assert.match(source,/X-Kids-Provider-Status/);
});

test('provider upstream failures return bounded JSON instead of surfacing cross-origin browser errors',()=>{
  assert.match(source,/providerFailure\("UPSTREAM_UNAVAILABLE"/);
  assert.match(source,/MAX_PROVIDER_BYTES = 2000000/);assert.match(source,/text\.length>MAX_PROVIDER_BYTES/);
  assert.match(source,/try\{JSON\.parse\(text\);\}catch\{return providerFailure\("UPSTREAM_INVALID"/);
  assert.match(source,/r\.status>=300&&r\.status<400/);
});

test('channel metadata extracts only safe Google-hosted thumbnails',()=>{
  assert.match(source,/metaContent\(html,"og:image"\)/);assert.match(source,/"avatar"\\s\*:/);
  for(const host of ['img.youtube.com','i.ytimg.com','yt3.ggpht.com','yt3.googleusercontent.com'])assert.match(source,new RegExp(host.replace(/[.]/g,'\\.')));
  assert.doesNotMatch(source,/endsWith\("\."\+base\)/);assert.match(source,/u\.protocol==="https:"/);assert.match(source,/thumbnail=safeThumbnail/);
});

test('edge function bounds state, metadata and request body work with explicit timeouts and limits',()=>{
  assert.match(source,/STATE_TIMEOUT_MS = 6000/);assert.match(source,/METADATA_TIMEOUT_MS = 5000/);
  assert.match(source,/timed\(STATE_TIMEOUT_MS/);assert.match(source,/timed\(METADATA_TIMEOUT_MS/);
  assert.match(source,/MAX_BODY_BYTES = 1100000/);assert.match(source,/return json\(\{error:"TOO_LARGE"\},413,origin\)/);
  assert.match(source,/return json\(\{error:"BAD_JSON"\},400,origin\)/);
  assert.match(source,/redirect:"manual"/);
});

test('parent session token validation rejects oversized, malformed and implausibly long signed sessions',()=>{
  assert.match(source,/if\(raw\.length>4096\)return false/);
  assert.match(source,/if\(parts\.length!==2\)return false/);
  assert.match(source,/p\.iat<=now\+300000/);assert.match(source,/p\.exp-p\.iat<=91\*86400000/);
});

test('proxy allowlist has no wildcard host or generic path escape hatch',()=>{
  assert.doesNotMatch(source,/PROVIDER_ORIGINS[\s\S]{0,300}\*/);
  assert.doesNotMatch(source,/startsWith\("\/api\/v1\/"/);
  assert.match(source,/u\.protocol!=="https:"\|\|u\.username\|\|u\.password\|\|u\.port/);
});

test('YouTube metadata redirects are followed only inside exact allowed YouTube page hosts',()=>{
  assert.match(source,/const YOUTUBE_PAGE_HOSTS = new Set\(\["youtube\.com","www\.youtube\.com","m\.youtube\.com","music\.youtube\.com"\]\)/);
  assert.match(source,/function safeYoutubePage/);assert.match(source,/!YOUTUBE_PAGE_HOSTS\.has\(h\)/);
  assert.match(source,/for\(let redirects=0;redirects<=3;redirects\+\+\)/);
  assert.match(source,/current=safeYoutubePage\(location,current\.href\)/);
});
