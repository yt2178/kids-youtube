const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const guard=fs.readFileSync('android/app/src/main/java/il/kidsyoutube/FamilyPlaybackGuard.java','utf8');
const activity=fs.readFileSync('android/app/src/main/java/il/kidsyoutube/FamilyPairingActivity.java','utf8');
test('authorization guard never reads legacy state and always validates both grants and catalog',()=>{
 assert.match(guard,/auth\.playbackGrants\(accessToken\)/);
 assert.match(guard,/auth\.catalogIds\(accessToken\)/);
 assert.match(guard,/catalog\.assertMatches\(grants\)/);
 assert.match(guard,/FAMILY_NOT_APPROVED/);
 assert.doesNotMatch(guard,/NativeApi|kids_youtube_state|sharedCatalog|legacy/);
});
test('debug family screen checks a video but does not launch playback',()=>{
 assert.match(activity,/videoCheckButton\.setOnClickListener/);
 assert.match(activity,/new FamilyPlaybackGuard\(auth\)\.authorizeVideo/);
 assert.match(activity,/ללא ניגון/);
});
