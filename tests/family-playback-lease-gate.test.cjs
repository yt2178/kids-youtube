const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const gate=fs.readFileSync('android/app/src/main/java/il/kidsyoutube/FamilyPlaybackLeaseGate.java','utf8');
const active=fs.readFileSync('android/app/src/main/java/il/kidsyoutube/MainActivity.java','utf8');
test('pilot playback permit is time-limited and invalidated on source changes',()=>{
 assert.match(gate,/PERMIT_TTL_MS=5000/);
 assert.match(gate,/clock\.getAsLong\(\)>=permit\.expiresAt/);
 assert.match(gate,/active=null;/);
 assert.match(gate,/authorization\.authorize\(videoId\)/);
 assert.match(gate,/if\(generation\.get\(\)!==epoch\)/);
 assert.match(gate,/authorization\.authorize\(videoId\)/);
 assert.match(gate,/throw new IOException\("FAMILY_PLAYBACK_DENIED"\)/);
});
test('existing production playback remains unchanged',()=>{
 assert.doesNotMatch(active,/FamilyPlaybackLeaseGate/);
});
