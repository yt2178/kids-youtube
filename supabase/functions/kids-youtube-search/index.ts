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
async function searchVideos(query:string,page:number,signal:AbortSignal){
 const {Innertube,Log}=await loadSearchLibrary();Log.setLevel(Log.Level.NONE);
 // Only fixed public YouTube metadata endpoints. Never forward parent credentials.
 const youtubeFetch=async(input:any,init:any={})=>{
  const url=new URL(typeof input==="string"?input:input.url||String(input));
  if(url.protocol!=="https:"||url.hostname!=="www.youtube.com"||url.port||url.username||url.password)throw Error("SEARCH_TARGET_DENIED");
  const response=await fetch(input,{...init,signal,redirect:"error"});
  if(!response.ok){await response.body?.cancel();throw Error("SEARCH_UPSTREAM");}
  const text=await bounded(response);
  return new Response(text,{status:response.status,headers:{"Content-Type":response.headers.get("Content-Type")||"application/json"}});
 };
 const client=await Innertube.create({lang:"he",location:"IL",retrieve_player:false,enable_safety_mode:true,enable_session_cache:false,fast_fail:true,fetch:youtubeFetch});
 let result=await client.search(query,{type:"video"});
 // Stateless bounded pagination survives Edge isolate changes, at most three pages.
 for(let i=1;i<page;i++){if(!result.has_continuation)return {items:[],nextPageToken:""};result=await result.getContinuation();}
 const seen=new Set<string>(),items:any[]=[];
 for(const video of result.videos){
  const id=String(video.id||video.content_id||"");
  if(!/^[A-Za-z0-9_-]{11}$/.test(id)||seen.has(id)||video.content_type&&video.content_type!=="VIDEO")continue;
  seen.add(id);
  const title=String(video.title||video.metadata?.title||"סרטון YouTube").slice(0,300);
  const author=String(video.author?.name||video.metadata?.metadata?.metadata_rows?.[0]?.metadata_parts?.[0]?.text||"").slice(0,200);
  items.push({id,title,author});if(items.length===50)break;
 }
 return {items,nextPageToken:page<3&&result.has_continuation?String(page+1):""};
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
  const result=await searchVideos(query,Number(page),controller.signal);
  if(controller.signal.aborted)throw Error("TIMEOUT");
  return reply(result);
 }catch{return reply({error:"SEARCH_UNAVAILABLE"},503);}finally{clearTimeout(timer);}
});
