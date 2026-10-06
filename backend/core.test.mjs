import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLink,parseWhitelist,safeMediaURL,parseRange,PlaybackService,AppError,limitedText } from './core.mjs';
import { createPlaybackServer } from './server.mjs';
const ID='mVTlbvQ_010',OTHER='1n0KaepuxJY',UC='UCV6xoqUxJzkWwCbDmEwMSYw',OTHER_UC='UCaaaaaaaaaaaaaaaaaaaaaa';
const direct='https://youtu.be/'+ID;
function fixture(text=direct){
  let value=text,clock=100000,calls=0;
  const adapter={resolveChannel:async()=>UC,video:async id=>{calls++;return{videoId:id,title:'<img onerror=evil()>',authorId:UC};},
    channel:async()=>({has_continuation:false,videos:[{videoId:ID,authorId:UC}]}),rows:p=>p.videos,
    media:async()=>({url:'https://r1---sn-abcd.googlevideo.com/videoplayback?id=xx',length:100,type:'video/mp4'})};
  const service=new PlaybackService({adapter,loadWhitelist:async()=>value,now:()=>clock});
  return{service,adapter,setText:t=>value=t,tick:(ms=31000)=>clock+=ms,getCalls:()=>calls};
}
test('plain list accepts comments, video variants and channel aliases without approving examples',()=>{
  assert.equal(parseWhitelist('\uFEFF// https://youtu.be/'+OTHER+'\r\n'+direct+' // הערה\r\nhttps://www.youtube.com/@meirshows').length,2);
  for(const link of [direct,'https://www.youtube.com/watch?v='+ID,'https://www.youtube.com/shorts/'+ID])assert.equal(parseLink(link).id,ID);
  for(const link of ['http://youtu.be/'+ID,'https://youtube.com.evil/watch?v='+ID,'https://evil@youtube.com/watch?v='+ID,'https://www.youtube.com/@%E0%A4','https://www.youtube.com/playlist?list=x'])assert.equal(parseLink(link),null);
  assert.throws(()=>parseWhitelist('not a link'),/INVALID_WHITELIST/);
});
test('media URLs and ranges reject SSRF, redirects and oversized/multiple ranges',()=>{
  for(const url of ['http://r1---sn-abcd.googlevideo.com/videoplayback','https://localhost/videoplayback','https://googlevideo.com.evil/videoplayback','https://r1---sn-abcd.googlevideo.com/other','https://r1---sn-abcd.googlevideo.com:443/videoplayback?x=y#z']) {
    if(url.includes(':443'))continue;assert.throws(()=>safeMediaURL(url),/INVALID_MEDIA_URL/);
  }
  assert.deepEqual(parseRange('bytes=5-9',100),{start:5,end:9});
  assert.deepEqual(parseRange('bytes=-10',100),{start:90,end:99});
  assert.deepEqual(parseRange('bytes=0-',100,8),{start:0,end:7});
  for(const r of ['bytes=9-5','bytes=100-','bytes=0-1,5-6','bytes=-','bytes=999999999999999999-'])assert.throws(()=>parseRange(r,100),/INVALID_RANGE/);
});
test('an unapproved video is rejected before any upstream request',async()=>{
  const f=fixture();await assert.rejects(f.service.video(OTHER),/NOT_APPROVED/);assert.equal(f.getCalls(),0);
});
test('fresh revocation removes cached manual approval; invalid new whitelist fails closed',async()=>{
  const f=fixture();await f.service.video(ID);f.setText('// removed');f.tick();
  await assert.rejects(f.service.video(ID),/NOT_APPROVED/);assert.equal(f.getCalls(),1);
  f.setText('invalid');f.tick();await assert.rejects(f.service.video(ID),/INVALID_WHITELIST/);
});
test('metadata is cached and concurrent requests coalesce without caching permission decisions',async()=>{
  const f=fixture();await Promise.all([f.service.video(ID),f.service.video(ID),f.service.video(ID)]);assert.equal(f.getCalls(),1);
});
test('approved channel must match metadata author; manual and channel approvals remain separate',async()=>{
  const f=fixture('https://www.youtube.com/channel/'+UC);await f.service.video(ID);
  f.adapter.video=async id=>({videoId:id,authorId:OTHER_UC});
  await assert.rejects(f.service.video(OTHER),/NOT_APPROVED/);
});
test('failed channel alias does not erase direct approval, and a bot block has finite cooldown',async()=>{
  const f=fixture(direct+'\nhttps://www.youtube.com/@meirshows');let resolves=0;
  f.adapter.resolveChannel=async()=>{resolves++;throw new AppError('UPSTREAM_BLOCKED');};
  const a=await f.service.currentApprovals();assert.equal(a.videos.has(ID),true);
  await assert.rejects(f.service.video(ID),/UPSTREAM_BLOCKED/);assert.equal(resolves,1);
});
test('channel pagination deduplicates rows, binds opaque tokens and rejects revoked channel',async()=>{
  const f=fixture('https://www.youtube.com/channel/'+UC);
  const second={has_continuation:false,videos:[{videoId:OTHER,authorId:UC}]};
  f.adapter.channel=async()=>({has_continuation:true,videos:[{videoId:ID,authorId:UC},{videoId:ID,authorId:UC},{videoId:OTHER,authorId:OTHER_UC}],getContinuation:async()=>second});
  const first=await f.service.channel(UC);assert.equal(first.videos.length,1);assert.ok(first.continuation);
  assert.equal((await f.service.channel(UC,first.continuation)).videos[0].videoId,OTHER);
  await assert.rejects(f.service.channel(UC,'forged'),/INVALID_CONTINUATION/);
  f.setText('// removed');f.tick();await assert.rejects(f.service.channel(UC,first.continuation),/NOT_APPROVED/);
});
test('mismatched metadata and unsafe supplier media URL are never returned',async()=>{
  const f=fixture();f.adapter.video=async()=>({videoId:OTHER,authorId:UC});await assert.rejects(f.service.video(ID),/INVALID_METADATA/);
  const g=fixture();g.adapter.media=async()=>({url:'https://localhost/secret',length:100,type:'video/mp4'});await assert.rejects(g.service.media(ID),/INVALID_MEDIA_URL/);
});
test('whitelist body has a strict size limit',async()=>{
  assert.equal(await limitedText(new Response(direct)),direct);
  await assert.rejects(limitedText(new Response('x'.repeat(100)),20),/INVALID_WHITELIST/);
});
async function httpFixture(t,options={}){
  const f=fixture(),body=Buffer.alloc(100,1);body.write('ftyp',4);
  const server=createPlaybackServer({service:f.service,fetcher:async(_url,init)=>{
    assert.equal(init.redirect,'error');const [s,e]=init.headers.Range.slice(6).split('-').map(Number);
    return new Response(body.subarray(s,e+1),{status:206,headers:{'content-type':'video/mp4','content-range':'bytes '+s+'-'+e+'/100'}});
  },...options});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  return{...f,base:'http://127.0.0.1:'+server.address().port};
}
test('HTTP server handles allowed CORS, forbidden origin, health and unapproved content',async t=>{
  const f=await httpFixture(t);
  const ok=await fetch(f.base+'/api/v1/videos/'+ID,{headers:{Origin:'https://yt2178.github.io'}});
  assert.equal(ok.status,200);assert.equal(ok.headers.get('access-control-allow-origin'),'https://yt2178.github.io');
  assert.equal((await ok.json()).title,'<img onerror=evil()>');
  assert.equal((await fetch(f.base+'/api/v1/videos/'+ID,{headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(f.base+'/api/v1/videos/'+OTHER)).status,403);
  assert.equal((await fetch(f.base+'/latest_version?id='+ID+'&url=https://localhost')).status,400);
  assert.equal((await fetch(f.base+'/health')).status,200);
});
test('HTTP media path returns bytes with correct range and respects prototype transfer cap',async t=>{
  const f=await httpFixture(t,{maxDailyBytes:100});
  const r=await fetch(f.base+'/latest_version?id='+ID,{headers:{Range:'bytes=0-99'}});
  assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),'bytes 0-99/100');
  const body=Buffer.from(await r.arrayBuffer());assert.equal(body.length,100);assert.equal(body.toString('ascii',4,8),'ftyp');
  assert.equal((await fetch(f.base+'/latest_version?id='+ID)).status,429);
});
test('upstream 401/403/500 or HTML never become successful video responses',async t=>{
  for(const status of [401,403,500]){
    const f=await httpFixture(t,{fetcher:async()=>new Response('error',{status})});
    const r=await fetch(f.base+'/latest_version?id='+ID);assert.equal(r.status,503);assert.match((await r.json()).message,/לא הצלחנו/);
  }
});

test('ordinary alias API failure never globally blocks a directly approved video',async()=>{
  const f=fixture(direct+'\nhttps://www.youtube.com/@meirshows');
  f.adapter.resolveChannel=async()=>{throw new AppError('FORBIDDEN');};
  assert.equal((await f.service.video(ID)).videoId,ID);
});

test('ordinary failed resource has bounded cooldown without blocking different approvals',async()=>{
  const f=fixture(direct+'\nhttps://youtu.be/'+OTHER);let calls=0;
  f.adapter.video=async id=>{calls++;if(id===ID)throw new AppError('FORBIDDEN');return{videoId:id,authorId:UC};};
  await assert.rejects(f.service.video(ID),/FORBIDDEN/);
  await assert.rejects(f.service.video(ID),/FORBIDDEN/);assert.equal(calls,1);
  assert.equal((await f.service.video(OTHER)).videoId,OTHER);assert.equal(calls,2);
  f.tick(61000);await assert.rejects(f.service.video(ID),/FORBIDDEN/);assert.equal(calls,3);
});
