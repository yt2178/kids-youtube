// SPDX-License-Identifier: GPL-3.0-or-later
// Parent-only, metadata-only search. No media extraction or YouTube login.
const PARENT_ORIGIN="https://yt2178.github.io";
const AUTH_URL=Deno.env.get("SUPABASE_URL")+"/functions/v1/kids-youtube?action=status";
const TIMEOUT_MS=15000, MAX_BYTES=4000000;
function reply(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Access-Control-Allow-Origin":PARENT_ORIGIN,"Access-Control-Allow-Headers":"authorization, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"}});}
async function bounded(response:Response,max=MAX_BYTES){
 const reader=response.body?.getReader();if(!reader)return "";
 let bytes=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>max)throw Error("TOO_LARGE");chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 const result=new Uint8Array(bytes);let pos=0;for(const chunk of chunks){result.set(chunk,pos);pos+=chunk.length;}return new TextDecoder().decode(result);
}
async function loadSearchLibrary(){return import("npm:youtubei.js@18.1.0/web");}
const VIDEO_ID=/^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID=/^UC[A-Za-z0-9_-]{22}$/;
const IMAGE_HOSTS=new Set(["yt3.googleusercontent.com","yt3.ggpht.com","i.ytimg.com","img.youtube.com"]);
function safeImage(raw:unknown){
 if(typeof raw!=="string"||raw.length>2500)return "";
 try{
  const u=new URL(raw);
  return u.protocol==="https:"&&!u.username&&!u.password&&!u.port&&IMAGE_HOSTS.has(u.hostname.toLowerCase())?u.href:"";
 }catch{return "";}
}
function channelThumbnail(node:any){
 // YouTube.js returns several distinct Channel/GridChannel shapes; an empty
 // author.thumbnails array must NOT suppress avatar/thumbnail alternatives.
 const sources=[
   node.author?.best_thumbnail,node.best_thumbnail,
   node.author?.thumbnails,node.thumbnails,node.thumbnail,
   node.avatar,node.author?.avatar,node.metadata?.avatar,
   node.metadata?.thumbnails,node.metadata?.thumbnail
 ];
 for(const value of sources){
   const thumbs=Array.isArray(value)?value:
     Array.isArray(value?.thumbnails)?value.thumbnails:
     Array.isArray(value?.image)?value.image:[value];
   for(let i=thumbs.length-1;i>=0;i--){
     const image=safeImage(typeof thumbs[i]==="string"?thumbs[i]:thumbs[i]?.url);
     if(image)return image;
   }
 }
 return "";
}
function normalizeChannels(results:any){
 const seen=new Set<string>(),items:any[]=[];
 for(const channel of results||[]){
  const id=String(channel.id||channel.channel_id||channel.author?.id||channel.metadata?.channel_id||"");
  if(!CHANNEL_ID.test(id)||seen.has(id))continue;
  seen.add(id);
  const title=String(channel.author?.name||channel.title?.text||channel.title||channel.metadata?.title||"ערוץ YouTube").slice(0,300);
  items.push({kind:"channel",id,title,author:"",thumbnail:channelThumbnail(channel)});
  if(items.length>=15)break;
 }
 return items;
}
function normalizeVideos(results:any){
 const seen=new Set<string>(),items:any[]=[];
 for(const video of results||[]){
  const id=String(video.id||video.content_id||"");
  if(!VIDEO_ID.test(id)||seen.has(id)||video.content_type&&video.content_type!=="VIDEO")continue;
  seen.add(id);
  const title=String(video.title||video.metadata?.title||"סרטון YouTube").slice(0,300);
  const author=String(video.author?.name||video.metadata?.metadata?.metadata_rows?.[0]?.metadata_parts?.[0]?.text||"").slice(0,200);
  items.push({kind:"video",id,title,author});if(items.length===50)break;
 }
 return items;
}
async function searchContent(query:string,page:number,signal:AbortSignal){
 const {Innertube,Log}=await loadSearchLibrary();Log.setLevel(Log.Level.NONE);
 // Search is metadata-only. Do not forward parent credentials to YouTube.
 const youtubeFetch=async(input:any,init:any={})=>{
  const url=new URL(typeof input==="string"?input:input.url||String(input));
  if(url.protocol!=="https:"||url.hostname!=="www.youtube.com"||url.port||url.username||url.password)throw Error("SEARCH_TARGET_DENIED");
  const response=await fetch(input,{...init,signal,redirect:"error"});
  if(!response.ok){await response.body?.cancel();throw Error("SEARCH_UPSTREAM");}
  const text=await bounded(response);
  return new Response(text,{status:response.status,headers:{"Content-Type":response.headers.get("Content-Type")||"application/json"}});
 };
 const client=await Innertube.create({lang:"he",location:"IL",retrieve_player:false,enable_safety_mode:true,enable_session_cache:false,fast_fail:true,fetch:youtubeFetch});
 // Only the first page searches channels. Later pages continue the video search
 // without repeating channels; the client places channel results first overall.
 const channelTask=page===1?client.search(query,{type:"channel"}):null;
 const videoTask=client.search(query,{type:"video"});
 const [channelsResult,videoResult]=await Promise.allSettled([channelTask,videoTask]);
 let channelItems:any[]=[];
 if(page===1&&channelsResult.status==="fulfilled"&&channelsResult.value)
   channelItems=normalizeChannels(channelsResult.value.channels||channelsResult.value.results);
 if(videoResult.status==="rejected"&&channelsResult.status==="rejected")throw Error("SEARCH_UPSTREAM");
 if(videoResult.status==="rejected"){
   if(!channelItems.length)throw Error("SEARCH_UPSTREAM");
   return {items:channelItems,nextPageToken:"",partial:true};
 }
 let result=videoResult.value;
 for(let i=1;i<page;i++){
  if(!result.has_continuation)return {items:[],nextPageToken:""};
  result=await result.getContinuation();
 }
 const videos=normalizeVideos(result.videos||[]);
 const partial=page===1&&channelsResult.status==="rejected";
 return {items:[...channelItems,...videos],nextPageToken:page<3&&result.has_continuation?String(page+1):"",partial};
}

Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin");if(origin&&origin!==PARENT_ORIGIN)return reply({error:"ORIGIN_DENIED"},403);
 if(req.method==="OPTIONS")return reply({},200);
 if(req.method!=="POST")return reply({error:"METHOD"},405);
 const authorization=req.headers.get("authorization")||"";
 if(!/^Bearer [^\s]{1,4096}$/.test(authorization))return reply({error:"UNAUTHORIZED"},401);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
 try{
  const raw=await bounded(new Response(req.body),2048);let body:any;
  try{body=JSON.parse(raw);}catch{return reply({error:"INVALID_SEARCH"},400);}
  const query=typeof body?.query==="string"?body.query.trim():"",page=body?.pageToken||"1";
  if(!query||query.length>120||!["1","2","3"].includes(page))return reply({error:"INVALID_SEARCH"},400);
  // Delegate to the existing password/session authority, never mint parent access.
  const auth=await fetch(AUTH_URL,{method:"POST",headers:{authorization,"Content-Type":"application/json"},body:"{}",signal:controller.signal,redirect:"error"});
  if(!auth.ok)return reply({error:"SEARCH_UNAVAILABLE"},503);
  const session=JSON.parse(await bounded(auth,4096));
  if(session.authenticated!==true)return reply({error:"UNAUTHORIZED"},401);
  const result=await searchContent(query,Number(page),controller.signal);
  if(controller.signal.aborted)throw Error("TIMEOUT");
  return reply(result);
 }catch{return reply({error:"SEARCH_UNAVAILABLE"},503);}finally{clearTimeout(timer);}
});
