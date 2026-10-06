import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { PlaybackService,AppError,WHITELIST_URL,limitedText,parseRange,safeMediaURL } from './core.mjs';
import { YouTubeAdapter } from './youtube.mjs';

const ORIGIN='https://yt2178.github.io';
const MAX_CHUNK=4*1024*1024;
export function createPlaybackServer({service,fetcher=fetch,maxDailyBytes=64*1024*1024,now=Date.now}){
  let active=0,bytes=0,day=new Date(now()).toISOString().slice(0,10);
  const counters=new Map();
  const server=createServer(async(req,res)=>{
    const controller=new AbortController(),timer=setTimeout(()=>{controller.abort();if(!res.headersSent){res.writeHead(504,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'TIMEOUT',message:'לא הצלחנו להפעיל את הסרטון כרגע. נסה שוב בעוד רגע.'}));}else res.destroy();},20000);
    res.on('close',()=>{clearTimeout(timer);controller.abort();});
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Vary','Origin');
    const origin=req.headers.origin;
    if(origin===ORIGIN){
      res.setHeader('Access-Control-Allow-Origin',ORIGIN);
      res.setHeader('Access-Control-Allow-Methods','GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','Range');
      res.setHeader('Access-Control-Expose-Headers','Content-Range, Accept-Ranges, Content-Length');
    }
    const json=(status,data)=>{if(!res.headersSent&&!res.destroyed&&!res.writableEnded){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}};
    let streamSlot=false;
    try{
      if(origin&&origin!==ORIGIN)throw new AppError('ORIGIN_NOT_ALLOWED',403);
      if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
      if(!['GET','HEAD'].includes(req.method))throw new AppError('METHOD_NOT_ALLOWED',405);
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/health'){json(200,{ok:true,version:'cloud-proof-1',playbackVerified:false});return;}
      const ip=req.socket.remoteAddress,minute=Math.floor(now()/60000),previous=counters.get(ip);
      const count=previous?.minute===minute?previous.count+1:1;
      if(counters.size>500)counters.clear();counters.set(ip,{minute,count});
      if(count>60)throw new AppError('RATE_LIMITED',429);
      const match=/^\/api\/v1\/videos\/([A-Za-z0-9_-]{11})$/.exec(url.pathname);
      if(match){json(200,await service.video(match[1]));return;}
      if(url.pathname==='/api/v1/resolveurl'){json(200,await service.resolve(url.searchParams.get('url')||''));return;}
      const channel=/^\/api\/v1\/channels\/(UC[A-Za-z0-9_-]{22})\/videos$/.exec(url.pathname);
      if(channel){json(200,await service.channel(channel[1],url.searchParams.get('continuation')||''));return;}
      if(url.pathname!=='/latest_version')throw new AppError('NOT_FOUND',404);
      if([...url.searchParams.keys()].some(k=>!['id','itag','local'].includes(k)))throw new AppError('INVALID_PARAMETERS',400);
      if(active>=2)throw new AppError('BUSY',429);
      active++;streamSlot=true;
      const media=await service.media(url.searchParams.get('id')||'');
      if(controller.signal.aborted)throw new AppError('TIMEOUT',504);
      const range=parseRange(req.headers.range,media.length,MAX_CHUNK);
      const size=range.end-range.start+1;
      const today=new Date(now()).toISOString().slice(0,10);
      if(today!==day){day=today;bytes=0;}
      // Prototype hard cap reduces exposure; this is not an account billing guarantee.
      if(bytes+size>maxDailyBytes)throw new AppError('DAILY_LIMIT',429);
      const headers={'Content-Type':media.type,'Content-Length':String(size),'Accept-Ranges':'bytes','Content-Range':'bytes '+range.start+'-'+range.end+'/'+media.length};
      if(req.method==='HEAD'){res.writeHead(206,headers);res.end();return;}
      bytes+=size;
      const upstream=await fetcher(safeMediaURL(media.url),{signal:controller.signal,redirect:'error',headers:{Range:'bytes='+range.start+'-'+range.end}});
      if(upstream.status!==206||upstream.headers.get('content-range')!==headers['Content-Range']){
        await upstream.body?.cancel();throw new AppError('MEDIA_RANGE_UNAVAILABLE');
      }
      if(!/^video\/mp4(?:;|$)/.test(upstream.headers.get('content-type')||'')){
        await upstream.body?.cancel();throw new AppError('VIDEO_UNAVAILABLE');
      }
      res.writeHead(206,headers);await pipeline(Readable.fromWeb(upstream.body),res,{signal:controller.signal});
    }catch(e){
      const code=e instanceof AppError?e.code:e?.name==='TimeoutError'||controller.signal.aborted?'TIMEOUT':'PROVIDER_ERROR';
      console.log(JSON.stringify({event:'request-failed',code})); // No supplier URLs, tokens or stack traces.
      if(res.headersSent)res.destroy();else json(e instanceof AppError?e.status:503,{error:code,message:'לא הצלחנו להפעיל את הסרטון כרגע. נסה שוב בעוד רגע.'});
    }finally{clearTimeout(timer);if(streamSlot)active--;}
  });
  server.requestTimeout=25000;server.headersTimeout=15000;return server;
}
export function productionService(){
  const adapter=new YouTubeAdapter();
  return new PlaybackService({adapter,loadWhitelist:async()=>{
    const response=await fetch(WHITELIST_URL,{signal:AbortSignal.timeout(8000),cache:'no-store'});
    return limitedText(response);
  }});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const server=createPlaybackServer({service:productionService()});
  server.listen(Number(process.env.PORT)||10000,'0.0.0.0',()=>console.log('kids-playback cloud-proof-1 listening'));
}
