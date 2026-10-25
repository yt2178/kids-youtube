const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('android/app/src/main/java/il/kidsyoutube/FamilyPairingActivity.java','utf8');
test('anonymous device identity is durably stored BEFORE consuming one-use pairing code',()=>{
 const signup=source.indexOf('session=auth.createAnonymous();');
 const persist=source.indexOf('store.save(session.refreshToken);',signup);
 const redeem=source.indexOf('pairing.pair(session.accessToken,code,name);',signup);
 assert.ok(signup>=0&&signup<persist&&persist<redeem,{signup,persist,redeem});
});
test('interrupted pairing restores same device identity and probes existing relationship',()=>{
 assert.match(source,/if\(saved!=null\)\{[\s\S]*?session=auth\.refresh\(saved\)/);
 const start=source.indexOf('if(saved!=null)');
 const end=source.indexOf('pairing.pair(session.accessToken,code,name);',start);
 const block=source.slice(start,end);
 assert.match(block,/store\.save\(session\.refreshToken\)/);
 assert.match(block,/auth\.list\(session\.accessToken\)/);
 assert.match(block,/FAMILY_HTTP_403/);
 assert.match(block,/throw prior;/);
});
test('refresh saves rotation before family access validation',()=>{
 const index=source.indexOf('verifyButton.setOnClickListener');
 const refresh=source.indexOf('auth.refresh(saved)',index);
 const persisted=source.indexOf('store.save(session.refreshToken);',refresh);
 const list=source.indexOf('auth.list(session.accessToken)',refresh);
 assert.ok(refresh>0 && refresh<persisted && persisted<list);
});
