const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const links=require('../parent-links.js');
const video='https://www.youtube.com/watch?v=mVTlbvQ_010',other='https://www.youtube.com/watch?v=AAAAAAAAAAA',channel='https://www.youtube.com/channel/UCV6xoqUxJzkWwCbDmEwMSYw';

test('parent video share canonicalizes and deduplicates equivalent links',()=>assert.equal(
  links.share('title '+video+' https://youtu.be/mVTlbvQ_010?si=x').url,video
));
test('parent channel UC and Unicode handles identify as channels',()=>{
  assert.equal(links.share(channel).kind,'channel');
  assert.equal(links.classify('https://youtube.com/@ערוץ').kind,'channel');
});
test('parent rejects multiple different video shares',()=>assert.throws(()=>links.share(video+' '+other)));
test('parent rejects malicious hosts, credentials, schemes, playlists and invalid IDs',()=>{
  for(const value of [
    'javascript:alert(1)',
    'https://youtube.com.evil.test/watch?v=mVTlbvQ_010',
    'https://x@youtube.com/watch?v=mVTlbvQ_010',
    'https://youtube.com/playlist?list=1',
    'https://youtu.be/invalid',
    'https://youtube.com/@bad%2Fpath'
  ]) assert.throws(()=>links.classify(value));
});
test('legacy GitHub issue mutation helpers are no longer exposed',()=>{
  assert.deepEqual(Object.keys(links).sort(),['classify','share']);
});
test('parent page uses password login, remembered session and direct backend save without GitHub navigation',()=>{
  const html=fs.readFileSync('parents.html','utf8'),script=fs.readFileSync('parents.js','utf8');
  assert.match(html,/type="password"/);assert.match(html,/זכור אותי/);
  assert.match(script,/localStorage/);assert.match(script,/sessionStorage/);
  assert.match(script,/functions\/v1\/kids-youtube/);
  assert.match(script,/encodeURIComponent\(action\)/);assert.match(script,/mutate/);
  assert.match(script,/logout/);
  assert.doesNotMatch(script,/github\.com|issues\/new|issueURL/);
  assert.doesNotMatch(html,/GitHub|המשך לאישור/);
});
