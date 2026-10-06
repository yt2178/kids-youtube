import { writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createPlaybackServer,productionService } from './server.mjs';
import { WHITELIST_URL,parseWhitelist,limitedText } from './core.mjs';

const report={date:new Date().toISOString(),source:'youtubei.js@18.1.0',metadata:false,mediaBytes:false,decodedVideo:false,browserPlayback:false,requests:[],result:'not-run'};
let server;
async function request(url,options={}){
  const start=Date.now();
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(45000)});
  report.requests.push({path:new URL(url).pathname,status:response.status,ms:Date.now()-start});return response;
}
async function decode(url){
  return new Promise((resolve,reject)=>{
    const child=spawn('ffmpeg',['-hide_banner','-loglevel','error','-rw_timeout','15000000','-i',url,'-frames:v','3','-f','image2','-update','1','qa/cloud-proof-frame.png'],{stdio:['ignore','ignore','pipe']});
    let errors='';child.stderr.on('data',x=>errors+=x.toString());
    const timer=setTimeout(()=>child.kill('SIGKILL'),45000);
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer);if(code===0)resolve();else reject(new Error('DECODER_FAILED: '+errors.slice(0,400).replace(/https?:\/\/\S+/g,'[url]')));});
  });
}
try{
  await mkdir('qa',{recursive:true});
  const list=parseWhitelist(await limitedText(await request(WHITELIST_URL)));
  const first=list.find(x=>x.kind==='video');if(!first)throw new Error('NO_MANUALLY_APPROVED_VIDEO');
  report.videoId=first.id;
  let base=process.env.PLAYBACK_PROBE_BASE;
  if(!base){
    server=createPlaybackServer({service:productionService()});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    base='http://127.0.0.1:'+server.address().port;
  }
  const meta=await request(base+'/api/v1/videos/'+first.id,{headers:{Origin:'https://yt2178.github.io'}});
  if(!meta.ok){const data=await meta.json();throw new Error(data.error||'METADATA_FAILED');}
  const data=await meta.json();if(data.videoId!==first.id)throw new Error('METADATA_ID_MISMATCH');
  report.metadata=true;report.title=data.title;
  if(meta.headers.get('access-control-allow-origin')!=='https://yt2178.github.io')throw new Error('CORS_CONFIGURATION_FAILED');
  const mediaURL=base+'/latest_version?id='+first.id+'&itag=18&local=true';
  const media=await request(mediaURL,{headers:{Range:'bytes=0-16383',Origin:'https://yt2178.github.io'}});
  if(media.status!==206)throw new Error((await media.json()).error||'MEDIA_FAILED');
  const bytes=Buffer.from(await media.arrayBuffer());
  if(bytes.length!==16384||bytes.toString('ascii',4,8)!=='ftyp')throw new Error('INVALID_MP4_BYTES');
  report.mediaBytes=true;
  await decode(mediaURL);report.decodedVideo=true;report.result='decoded-video-proven-browser-check-still-required';
}catch(e){
  report.result='failed';report.error=String(e.message||'PROBE_FAILED').replace(/https?:\/\/\S+/g,'[url]').slice(0,400);
  process.exitCode=1;
}finally{
  if(server)await new Promise(r=>{server.closeAllConnections();server.close(r);});
  await writeFile('qa/cloud-playback-proof.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
