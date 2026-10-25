const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const src=fs.readFileSync('android/app/src/main/java/il/kidsyoutube/FamilyPilotSmokeActivity.java','utf8');
const manifest=fs.readFileSync('android/app/src/main/AndroidManifest.xml','utf8');
const pairing=fs.readFileSync('android/app/src/main/java/il/kidsyoutube/FamilyPairingActivity.java','utf8');
const main=fs.readFileSync('android/app/src/main/java/il/kidsyoutube/MainActivity.java','utf8');
test('actual media smoke activity is private debug-only and never uses legacy grants',()=>{
 assert.match(manifest,/android:name="\.FamilyPilotSmokeActivity" android:exported="false"/);
 assert.match(src,/FLAG_DEBUGGABLE/);
 assert.match(src,/FamilyPlaybackGuard\(auth\)/);
 assert.match(src,/gate\.request\(videoId\)/);
 assert.match(src,/gate\.requireAuthorized\(checked,videoId\)/);
 assert.match(src,/ApprovalPolicy\.safeMedia\(url\)/);
 assert.doesNotMatch(src,/kids_youtube_state|NativeApi|sharedCatalog|\.whitelist\(/);
 assert.doesNotMatch(main,/FamilyPilotSmokeActivity/);
 assert.match(pairing,/new android\.content\.Intent\(this,FamilyPilotSmokeActivity\.class\)/);
});
test('real player is stopped on expiry, leaving foreground, explicit stop or error',()=>{
 assert.match(src,/new ExoPlayer\.Builder\(this\)\.build\(\)/);
 assert.match(src,/player\.setMediaItem\(MediaItem\.fromUri\(url\)\)/);
 assert.match(src,/main\.postDelayed\(expiry,remaining\)/);
 assert.match(src,/expiresAt-System\.currentTimeMillis\(\)/);
 assert.match(src,/onStop\(\)\{visible=false;stopPlayback\(\)/);
 assert.match(src,/onPlayerError\(PlaybackException error\)/);
 assert.match(src,/player\.stop\(\);player\.release\(\)/);
 assert.match(src,/view\.setUseController\(false\)/);
});
test('authorization and restricted media origin are checked after extraction and before play',()=>{
 const extracted=src.indexOf('String url=extractApprovedSource(videoId)');
 const authorized=src.indexOf('gate.request(videoId)',extracted);
 const media=src.indexOf('player.setMediaItem(MediaItem.fromUri(url))',authorized);
 const started=src.indexOf('player.play()',media);
 assert.ok(extracted>=0&&extracted<authorized&&authorized<media&&media<started);
 assert.ok(src.indexOf('gate.requireAuthorized(permit,videoId)',media)<started);
});

test('network and extractor errors never display raw signed URLs or server response bodies',()=>{
 assert.match(src,/MEDIA_TEST_UNAVAILABLE/);
 assert.match(src,/message\.matches\(/);
 assert.match(src,/error instanceof IOException\?error\.getMessage\(\)/);
 assert.doesNotMatch(src,/note\([^)]*error\.getMessage\(\)/);
 assert.doesNotMatch(src,/android\.util\.Log\.[a-z]+\(/);
});
