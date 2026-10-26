const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const java=fs.readFileSync('android/app/src/main/java/il/kidsyoutube/FamilyPilotSmokeActivity.java','utf8');
const ps=fs.readFileSync('tools/capture-family-playback.ps1','utf8');
const cmd=fs.readFileSync('capture-family-playback.cmd','utf8');
test('family smoke diagnostics expose only fixed stages, elapsed time and HTTP code',()=>{
 assert.match(java,/KidsFamilyPilot/);
 assert.match(java,/stage=media-http-status status=/);
 assert.match(java,/stage\.matches\("\[a-z0-9-\]/);
 assert.match(java,/onRenderedFirstFrame\(\)\{/);
 assert.match(java,/phase\("first-frame"\)/);
 assert.doesNotMatch(java,/Log\.[a-z]+\([^)]*(?:videoId|session|url|error\.getMessage)/);
});
test('local capture is non-destructive and emits only sanitized tagged lines',()=>{
 assert.match(cmd,/capture-family-playback\.ps1/);
 assert.match(ps,/adb devices/);
 assert.match(ps,/logcat -d/);
 assert.match(ps,/KidsFamilyPilot:I/);
 assert.match(ps,/stage=\(\?<stage>/);
 for(const dangerous of ['uninstall','pm clear','logcat -c','rm -rf','force-stop','input keyevent','shell am start']){
  assert.ok(!ps.includes(dangerous),'Unexpected dangerous ADB operation: '+dangerous);
 }
});

test('a play command alone is never counted as evidence of a rendered frame',()=>{
 assert.match(java,/firstFrameSeen=true/);
 assert.match(java,/phase\("outcome-first-frame-confirmed"\)/);
 assert.match(java,/phase\("outcome-no-first-frame"\)/);
 assert.match(ps,/FIRST_FRAME_CONFIRMED/);
 assert.match(ps,/NO_FIRST_FRAME/);
 assert.match(ps,/INCONCLUSIVE/);
 assert.match(ps,/stage=smoke-start/);
 assert.doesNotMatch(ps,/media3-play-request[^\n]*FIRST_FRAME_CONFIRMED/);
});
