import { AsyncLocalStorage } from 'node:async_hooks';
import { Innertube, Platform } from 'youtubei.js';
import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten';
import { AppError, CHANNEL_ID, safeMediaURL } from './core.mjs';

// Interpret supplier scripts in WebAssembly with no Node, network or filesystem bindings.
Platform.shim.eval=async data=>{
  if(typeof data.output!=='string'||data.output.length>4*1024*1024)throw new AppError('PLAYER_SCRIPT_UNAVAILABLE');
  const q=await getQuickJS();
  return q.evalCode(data.output,{memoryLimitBytes:64*1024*1024,shouldInterrupt:shouldInterruptAfterDeadline(Date.now()+1500)});
};
const requestContext=new AsyncLocalStorage();
export async function boundedFetch(input,init={}) {
  const signal=AbortSignal.any([AbortSignal.timeout(8000),init.signal,requestContext.getStore()].filter(Boolean));
  const result=await fetch(input,{...init,signal});
  if([401,403,429].includes(result.status))throw new AppError(result.status===429?'RATE_LIMITED':'UPSTREAM_BLOCKED');
  if(!result.ok)throw new AppError('UPSTREAM_ERROR');
  return result;
}
const text=value=>typeof value==='string'?value.slice(0,300):String(value?.text||value||'').slice(0,300);
export class YouTubeAdapter {
  constructor(){this.sessionTask=null;this.raw=new WeakMap();}
  async session(){
    if(!this.sessionTask)this.sessionTask=Innertube.create({lang:'he',location:'IL',fast_fail:true,fetch:boundedFetch}).catch(e=>{this.sessionTask=null;throw e;});
    return this.sessionTask;
  }
  async resolveChannel(url){return requestContext.run(AbortSignal.timeout(10000),()=>this._resolveChannel(url));}
  async _resolveChannel(url){
    const yt=await this.session();const endpoint=await yt.resolveURL(url);
    const id=endpoint.payload?.browseId;
    if(!CHANNEL_ID.test(id||''))throw new AppError('INVALID_CHANNEL');return id;
  }
  async video(id){return requestContext.run(AbortSignal.timeout(12000),()=>this._video(id));}
  async _video(id){
    const yt=await this.session();const info=await yt.getBasicInfo(id);
    if(info.playability_status?.status!=='OK'){
      const reason=text(info.playability_status?.reason);
      if(/bot|sign in|confirm|login/i.test(reason)||info.playability_status?.status==='LOGIN_REQUIRED')
        throw new AppError('UPSTREAM_BLOCKED');
      throw new AppError('VIDEO_UNAVAILABLE',404);
    }
    const b=info.basic_info;
    if(b.id!==id)throw new AppError('INVALID_METADATA');
    const data={videoId:id,title:text(b.title),author:text(b.author),authorId:b.channel_id,lengthSeconds:b.duration};
    this.raw.set(data,{info,yt});return data;
  }
  async media(data){
    const {info,yt}=this.raw.get(data)||{};
    if(!info)throw new AppError('VIDEO_UNAVAILABLE');
    // Single MP4 with both audio and video; unsupported DASH/SABR is reported honestly.
    const format=info.chooseFormat({type:'video+audio',format:'mp4',quality:'360p'});
    if(!format.has_audio||!format.has_video)throw new AppError('VIDEO_UNAVAILABLE');
    const u=safeMediaURL(await format.decipher(yt.session.player));u.searchParams.set('cpn',info.cpn);
    return {url:u.href,length:format.content_length,type:format.mime_type};
  }
  async channel(id){return requestContext.run(AbortSignal.timeout(12000),async()=>{const yt=await this.session();return (await yt.getChannel(id)).getVideos();});}
  rows(page,id){
    return page.videos.map(v=>({videoId:v.id||v.content_id,title:text(v.title||v.metadata?.title),author:text(v.author?.name),
      authorId:v.author?.id||id,published:0}));
  }
}
