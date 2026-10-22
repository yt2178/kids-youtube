const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const root='android/app/src/main/';
const store=fs.readFileSync(root+'java/il/kidsyoutube/FamilySessionStore.java','utf8');
const activity=fs.readFileSync(root+'java/il/kidsyoutube/FamilyPairingActivity.java','utf8');
const launcher=fs.readFileSync(root+'java/il/kidsyoutube/MainActivity.java','utf8');
const manifest=fs.readFileSync(root+'AndroidManifest.xml','utf8');
test('family pilot tokens are encrypted in Android Keystore, not plaintext preferences',()=>{
 assert.match(store,/AndroidKeyStore/);
 assert.match(store,/AES\/GCM\/NoPadding/);
 assert.match(store,/setRandomizedEncryptionRequired\(true\)/);
 assert.match(store,/GCMParameterSpec\(128,iv\)/);
 assert.match(store,/catch\(Exception error\)\{\s*clear\(\)/);
 assert.doesNotMatch(store,/putString\(REFRESH,refreshToken\)/);
});
test('pairing UI is debug only, private, and cannot mutate legacy playback',()=>{
 assert.match(launcher,/FLAG_DEBUGGABLE/);
 assert.match(launcher,/new android\.content\.Intent\(this,FamilyPairingActivity\.class\)/);
 assert.match(manifest,/android:name="\.FamilyPairingActivity" android:exported="false"/);
 assert.match(activity,/auth\.createAnonymous\(\)/);
 assert.match(activity,/pairing\.pair\(session\.accessToken,code,name\)/);
 assert.match(activity,/store\.save\(session\.refreshToken\)/);
 assert.match(activity,/auth\.list\(session\.accessToken\)/);
 assert.doesNotMatch(activity,/NativeApi|kids_youtube_state|new ExoPlayer|legacyToken/);
});
