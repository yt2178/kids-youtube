const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('supabase/functions/kids-youtube/index.ts','utf8');

test('parent provider proxy is authenticated and restricted to exact configured origins and API paths',()=>{
  assert.match(source,/const PROVIDER_ORIGINS = new Set\(\[/);
  for(const origin of ['https://invidious.f5.si','https://invidious.tiekoetter.com','https://yt.chocolatemoo53.com'])assert.match(source,new RegExp(origin.replace(/[.]/g,'\\.')));
  assert.match(source,/action==="provider"/);assert.match(source,/if\(!await auth\(req,s\)\)return json\(\{error:"UNAUTHORIZED"\},401,origin\)/);
  assert.match(source,/PROVIDER_ORIGINS\.has\(u\.origin\)/);
  assert.match(source,/\/api\\\/v1\\\/videos/);assert.match(source,/\/api\\\/v1\\\/channels/);
  assert.match(source,/u\.pathname==="\/api\/v1\/resolveurl"/);assert.match(source,/u\.pathname==="\/api\/v1\/stats"/);
  assert.doesNotMatch(source,/proxyProvider[\s\S]{0,900}redirect:"follow"/);
});

test('provider upstream failures return bounded JSON instead of surfacing cross-origin browser errors',()=>{
  assert.match(source,/if\(!r\.ok\)return json\(\{error:"UPSTREAM_UNAVAILABLE"\},200,origin\)/);
  assert.match(source,/if\(text\.length>2000000\)/);
  assert.match(source,/try\{JSON\.parse\(text\);\}catch\{return json\(\{error:"UPSTREAM_INVALID"\},200,origin\);\}/);
});

test('channel metadata extracts only safe Google-hosted thumbnails',()=>{
  assert.match(source,/metaContent\(html,"og:image"\)/);assert.match(source,/"avatar"\\s\*:/);
  assert.match(source,/\["ggpht\.com","googleusercontent\.com","ytimg\.com"\]/);
  assert.match(source,/u\.protocol==="https:"/);assert.match(source,/thumbnail=safeThumbnail/);
});
