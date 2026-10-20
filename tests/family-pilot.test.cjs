const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const html=fs.readFileSync('family-pilot.html','utf8'),js=fs.readFileSync('family-pilot.js','utf8');
test('family pilot is separate, no legacy state, no tokens persisted',()=>{
 assert.match(html,/סביבת ניסוי/);assert.match(html,/parents\.html/);
 assert.match(js,/auth\/v1\/token\?grant_type=password/);
 assert.match(js,/kids-youtube-family\?action=list/);
 assert.match(js,/kids-youtube-family\?action=enroll/);
 assert.match(js,/kids-youtube-family\?action=replace/);
 assert.match(js,/expectedVersion:version/);
 assert.doesNotMatch(js,/kids_youtube_state|localStorage|sessionStorage|service_role|x-family-id/);
 assert.match(js,/window\.addEventListener\('pagehide'/);
 assert.doesNotMatch(html,/<script[^>]*>(?!<\/script>)/i);
});
