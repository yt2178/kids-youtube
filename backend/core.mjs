import { createHash, randomUUID } from 'node:crypto';
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
export const WHITELIST_URL = 'https://raw.githubusercontent.com/yt2178/kids-youtube/main/videos.txt';
const HOSTS = new Set(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be','www.youtu.be']);
export class AppError extends Error {
  constructor(code,status=503) { super(code); this.code=code; this.status=status; }
}
export function parseLink(value) {
  let url; try { url=new URL(value); } catch { return null; }
  if(url.protocol!=='https:'||!HOSTS.has(url.hostname)||url.username||url.password||url.port) return null;
  let decoded;try{decoded=decodeURIComponent(url.pathname);}catch{return null;}
  const p=decoded.split('/').filter(Boolean);
  let id;
  if(url.hostname.endsWith('youtu.be') && p.length===1) id=p[0];
  else if(p.length===1 && p[0]==='watch') id=url.searchParams.get('v');
  else if(p.length===2 && ['shorts','live','embed'].includes(p[0])) id=p[1];
  if(VIDEO_ID.test(id||'')) return {kind:'video',id,url:'https://www.youtube.com/watch?v='+id};
  if(p.length===2 && p[0]==='channel' && CHANNEL_ID.test(p[1]))
    return {kind:'channel',id:p[1],url:'https://www.youtube.com/channel/'+p[1]};
  if(p.length===1 && /^@[\p{L}\p{N}_.-]{1,100}$/u.test(p[0]) ||
     p.length===2 && ['c','user'].includes(p[0]) && /^[\p{L}\p{N}_.-]{1,100}$/u.test(p[1]))
    return {kind:'alias',url:'https://www.youtube.com/'+p.map(x=>encodeURIComponent(x)).join('/')};
  return null;
}
export function parseWhitelist(text) {
  if(typeof text!=='string'||text.length>65536) throw new AppError('INVALID_WHITELIST');
  const links=new Map();
  for(const line of text.replace(/^\uFEFF/,'').split(/\r?\n/)) {
    const input=line.trim(); if(!input || input.startsWith('//')) continue;
    const link=parseLink(input.split(/\s+\/\//)[0].trim());
    if(!link) throw new AppError('INVALID_WHITELIST');
    links.set(link.kind==='video'?'v:'+link.id:link.url,link);
    if(links.size>500) throw new AppError('INVALID_WHITELIST');
  }
  return [...links.values()];
}
export function safeMediaURL(value) {
  let u;try{u=new URL(value);}catch{throw new AppError('INVALID_MEDIA_URL');}
  // Exact public Googlevideo distribution hosts; never accept user-supplied URLs.
  if(u.protocol!=='https:'||u.username||u.password||u.port||
     !/^r[0-9]+---sn-[a-z0-9-]+\.googlevideo\.com$/i.test(u.hostname)||
     u.pathname!=='/videoplayback') throw new AppError('INVALID_MEDIA_URL');
  return u;
}
export function parseRange(header,total,maxChunk=4*1024*1024) {
  if(!Number.isSafeInteger(total)||total<1) throw new AppError('VIDEO_UNAVAILABLE');
  if(!header) return {start:0,end:Math.min(total-1,maxChunk-1)};
  const m=/^bytes=(\d*)-(\d*)$/.exec(header);
  if(!m||!m[1]&&!m[2]) throw new AppError('INVALID_RANGE',416);
  let start=m[1]?Number(m[1]):Math.max(0,total-Number(m[2]));
  let end=m[1]&&m[2]?Number(m[2]):total-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=total||end<start)
    throw new AppError('INVALID_RANGE',416);
  return {start,end:Math.min(end,total-1,start+maxChunk-1)};
}
export async function limitedText(response,limit=65536) {
  if(!response.ok) throw new AppError('WHITELIST_UNAVAILABLE');
  const reader=response.body.getReader();const chunks=[];let size=0;
  try {while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw new AppError('INVALID_WHITELIST');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks).toString('utf8');
}
export class PlaybackService {
  constructor({adapter,loadWhitelist,now=Date.now}) {
    this.adapter=adapter;this.loadWhitelist=loadWhitelist;this.now=now;
    this.approvals=null;this.approvalsAt=0;this.approvalTask=null;
    this.cache=new Map();this.pending=new Map();this.pages=new Map();
    this.blockedUntil=0;
  }
  async cached(key,ttl,fn) {
    const entry=this.cache.get(key);if(entry&&entry.until>this.now())return entry.value;
    if(this.pending.has(key))return this.pending.get(key);
    const task=Promise.resolve().then(fn).then(value=>{
      if(this.cache.size>=200)this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key,{value,until:this.now()+ttl});return value;
    }).finally(()=>this.pending.delete(key));
    this.pending.set(key,task);return task;
  }
  async currentApprovals() {
    if(this.approvals&&this.approvalsAt+30000>this.now())return this.approvals;
    if(this.approvalTask)return this.approvalTask;
    this.approvalTask=(async()=>{
      const text=await this.loadWhitelist();const links=parseWhitelist(text);
      const videos=new Set(links.filter(x=>x.kind==='video').map(x=>x.id));
      const channels=new Set(links.filter(x=>x.kind==='channel').map(x=>x.id));
      const aliases=new Map();
      // Alias failures cannot suppress directly approved video IDs.
      const queue=links.filter(x=>x.kind==='alias');let cursor=0;
      const budget=this.now()+10000;
      await Promise.all(Array.from({length:Math.min(3,queue.length)},async()=>{
        while(cursor<queue.length&&this.now()<budget){
          const x=queue[cursor++];
          try{const id=await this.upstream(()=>this.adapter.resolveChannel(x.url));if(!CHANNEL_ID.test(id))throw new AppError('INVALID_CHANNEL');channels.add(id);aliases.set(x.url,id);}catch{}
        }
      }));
      const fingerprint=createHash('sha256').update(text+JSON.stringify([...aliases])).digest('hex');
      if(this.approvals?.fingerprint!==fingerprint)this.pages.clear();
      this.approvals={videos,channels,aliases,fingerprint};this.approvalsAt=this.now();return this.approvals;
    })().catch(e=>{this.approvals=null;this.pages.clear();throw e;}).finally(()=>this.approvalTask=null);
    return this.approvalTask;
  }
  async upstream(fn) {
    if(this.blockedUntil>this.now())throw new AppError('UPSTREAM_BLOCKED');
    try{return await fn();}catch(e){
      if(e?.code==='UPSTREAM_BLOCKED'){this.blockedUntil=this.now()+15*60*1000;this.cache.clear();}
      throw e;
    }
  }
  async video(id) {
    if(!VIDEO_ID.test(id))throw new AppError('INVALID_ID',400);
    const approved=await this.currentApprovals();
    if(!approved.videos.has(id)&&!approved.channels.size)throw new AppError('NOT_APPROVED',403);
    const data=await this.cached('video:'+id,5*60*1000,()=>this.upstream(()=>this.adapter.video(id)));
    if(data?.videoId!==id||!CHANNEL_ID.test(data.authorId||''))throw new AppError('INVALID_METADATA');
    if(!approved.videos.has(id)&&!approved.channels.has(data.authorId))throw new AppError('NOT_APPROVED',403);
    return data;
  }
  async channel(id,continuation='') {
    if(!CHANNEL_ID.test(id))throw new AppError('INVALID_ID',400);
    const approvals=await this.currentApprovals();
    if(!approvals.channels.has(id))throw new AppError('NOT_APPROVED',403);
    let page;
    if(continuation){
      const saved=this.pages.get(continuation);
      if(!saved||saved.id!==id||saved.fingerprint!==approvals.fingerprint||saved.until<this.now())
        throw new AppError('INVALID_CONTINUATION',400);
      page=await this.cached('page:'+continuation,60000,()=>this.upstream(()=>saved.feed.getContinuation()));
    }else{
      page=await this.cached('channel:'+id,60000,()=>this.upstream(()=>this.adapter.channel(id)));
    }
    const videos=[],seen=new Set();
    for(const item of this.adapter.rows(page,id)){
      if(VIDEO_ID.test(item.videoId||'')&&item.authorId===id&&!seen.has(item.videoId)){seen.add(item.videoId);videos.push(item);}
      if(videos.length>=100)break;
    }
    let next=null;
    if(page.has_continuation){
      // Reuse a continuation for the same feed: retries do not grow this map.
      for(const [token,saved]of this.pages){if(saved.feed===page&&saved.id===id&&saved.until>this.now()){next=token;break;}}
      if(!next){next=randomUUID();if(this.pages.size>=200)this.pages.delete(this.pages.keys().next().value);this.pages.set(next,{feed:page,id,fingerprint:approvals.fingerprint,until:this.now()+10*60*1000});}
    }
    return {videos,continuation:next};
  }
  async resolve(url) {
    const link=parseLink(url);if(!link||link.kind==='video')throw new AppError('INVALID_URL',400);
    const approved=await this.currentApprovals();
    const id=link.kind==='channel'?link.id:approved.aliases.get(link.url);
    if(!id||!approved.channels.has(id))throw new AppError('NOT_APPROVED',403);
    return {ucid:id,browseId:id};
  }
  async media(id) {
    const info=await this.video(id);
    const media=await this.cached('media:'+id,60000,()=>this.upstream(()=>this.adapter.media(info)));
    safeMediaURL(media.url);
    if(!Number.isSafeInteger(media.length)||media.length<1||!/^video\/mp4(?:;|$)/.test(media.type))throw new AppError('VIDEO_UNAVAILABLE');
    return media;
  }
}
