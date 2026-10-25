const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const activity=fs.readFileSync('android/app/src/main/java/il/kidsyoutube/FamilyPairingActivity.java','utf8');
test('debug pairing screen validates family catalog with matching grants without legacy playback',()=>{
 assert.match(activity,/catalogButton\.setOnClickListener/);
 assert.match(activity,/auth\.playbackGrants\(session\.accessToken\)/);
 assert.match(activity,/auth\.catalogIds\(session\.accessToken\)/);
 assert.match(activity,/catalog\.assertMatches\(grants\)/);
 const block=activity.slice(activity.indexOf('catalogButton.setOnClickListener'));
 assert.doesNotMatch(block,/new NativeApi|new ExoPlayer|kids_youtube_state|\.sharedCatalog\(/);
});
test('refresh rotation is persisted before reading family-specific grants',()=>{
 const block=activity.slice(activity.indexOf('catalogButton.setOnClickListener'));
 assert.ok(block.indexOf('store.save(session.refreshToken)')<block.indexOf('auth.playbackGrants('));
 assert.ok(block.indexOf('auth.playbackGrants(')<block.indexOf('auth.catalogIds('));
});
