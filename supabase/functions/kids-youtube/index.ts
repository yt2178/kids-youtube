const WEB_ORIGIN = "https://yt2178.github.io";
const ANDROID_ORIGIN = "https://appassets.androidplatform.net";
const ALLOWED_ORIGINS = new Set([WEB_ORIGIN, ANDROID_ORIGIN]);
const PROVIDER_ORIGINS = new Set([
  "https://invidious.f5.si",
  "https://invidious.tiekoetter.com",
  "https://yt.chocolatemoo53.com"
]);
const BASE = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STATE_TIMEOUT_MS = 6000;
const METADATA_TIMEOUT_MS = 5000;
const PROVIDER_TIMEOUT_MS = 3500;
const MAX_PROVIDER_BYTES = 2000000;
const MAX_YOUTUBE_HTML_BYTES = 4000000;
const MAX_BODY_BYTES = 1100000;
const SAFE_IMAGE_HOSTS = new Set(["img.youtube.com","i.ytimg.com","yt3.ggpht.com","yt3.googleusercontent.com"]);
const YOUTUBE_PAGE_HOSTS = new Set(["youtube.com","www.youtube.com","m.youtube.com","music.youtube.com"]);
const ROW = BASE + "/rest/v1/kids_youtube_state?singleton=eq.true&select=list_text,password_hash,session_secret,version,updated_at";

function cors(origin:string|null){
  const allowed = origin ? ALLOWED_ORIGINS.has(origin) : false;
  return {
    "Access-Control-Allow-Origin": allowed ? origin! : WEB_ORIGIN,
    "Access-Control-Allow-Headers":"authorization, content-type",
    "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
    "Access-Control-Max-Age":"600",
    "Access-Control-Expose-Headers":"X-Kids-Provider-Status",
    "Vary":"Origin",
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff"
  };
}
function json(body:unknown,status=200,origin:string|null=null){return new Response(JSON.stringify(body),{status,headers:cors(origin)});}
async function timed<T>(ms:number,task:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),ms);
  try{return await task(controller.signal);}finally{clearTimeout(timer);}
}
function oversized(response:Response,max:number){
  const raw=response.headers.get("content-length");if(!raw)return false;
  const size=Number(raw);return Number.isFinite(size)&&size>max;
}
async function readBounded(stream:ReadableStream<Uint8Array>|null,max:number){
  if(!stream)return "";
  const reader=stream.getReader(),chunks:Uint8Array[]=[];let total=0;
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;if(!value)continue;
      total+=value.byteLength;if(total>max){await reader.cancel("TOO_LARGE").catch(()=>{});throw Error("TOO_LARGE");}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const out=new Uint8Array(total);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength;}
  return new TextDecoder().decode(out);
}
function providerFailure(error:string,status:number,origin:string|null){
  return new Response(JSON.stringify({error}),{status:200,headers:{...cors(origin),"X-Kids-Provider-Status":String(status)}});
}
function b64url(bytes:Uint8Array){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
function unb64url(s:string){s=s.replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";const raw=atob(s);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
async function sha256(text:string){return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text))));}
async function hmac(secret:string,text:string){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(text))));
}
function constantTime(a:string,b:string){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
async function state(){
  return timed(STATE_TIMEOUT_MS,async signal=>{
    const r=await fetch(ROW,{headers:{apikey:SERVICE,Authorization:"Bearer "+SERVICE},signal});
    if(!r.ok)throw Error("STATE_READ");
    const a=await r.json(); if(!Array.isArray(a)||a.length!==1)throw Error("STATE_MISSING"); return a[0];
  });
}
async function patch(expectedVersion:number, data:Record<string,unknown>){
  const url=BASE+"/rest/v1/kids_youtube_state?singleton=eq.true&version=eq."+expectedVersion;
  return timed(STATE_TIMEOUT_MS,async signal=>{
    const r=await fetch(url,{method:"PATCH",headers:{apikey:SERVICE,Authorization:"Bearer "+SERVICE,"Content-Type":"application/json","Prefer":"return=representation"},body:JSON.stringify({...data,version:expectedVersion+1,updated_at:new Date().toISOString()}),signal});
    if(!r.ok)throw Error("STATE_WRITE");
    const a=await r.json(); return Array.isArray(a)&&a.length===1;
  });
}
async function passwordHash(password:string,secret:string){return sha256(secret+"\0"+password);}
async function makeToken(secret:string,days:number){
  const payload={exp:Date.now()+days*86400000,iat:Date.now(),v:1};
  const body=b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return body+"."+await hmac(secret,body);
}
async function auth(req:Request,s:any){
  const raw=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(raw.length>4096)return false;
  const parts=raw.split(".");if(parts.length!==2)return false;
  const [body,sig]=parts;if(!body||!sig)return false;
  if(!constantTime(await hmac(s.session_secret,body),sig))return false;
  try{
    const p=JSON.parse(new TextDecoder().decode(unb64url(body))),now=Date.now();
    return p&&p.v===1&&Number.isFinite(p.iat)&&Number.isFinite(p.exp)
      && p.iat<=now+300000&&p.exp>now&&p.exp-p.iat<=91*86400000;
  }catch{return false;}
}
function canonicalize(input:string){
  if(typeof input!=="string"||input.length>4096||!input.trim()||/\s/.test(input.trim()))throw Error("INVALID_LINK");
  let value=input.trim(); if(!/^https?:\/\//i.test(value))value="https://"+value;
  const u=new URL(value),host=u.hostname.toLowerCase(),parts=u.pathname.split("/").filter(Boolean);
  if(!["http:","https:"].includes(u.protocol)||u.username||u.password||u.port)throw Error("INVALID_LINK");
  const vid=/^[A-Za-z0-9_-]{11}$/; const cid=/^UC[A-Za-z0-9_-]{22}$/; let id:string|null=null;
  if(host==="youtu.be"){if(parts.length===1)id=parts[0];}
  else if(["youtube.com","www.youtube.com","m.youtube.com","music.youtube.com"].includes(host)){
    if(parts[0]==="watch"&&parts.length===1&&u.searchParams.getAll("v").length===1)id=u.searchParams.get("v");
    else if(["shorts","live","embed"].includes(parts[0])&&parts.length===2)id=parts[1];
    else{
      const tail=["videos","shorts","streams","featured"];
      if(parts[0]==="channel"&&cid.test(parts[1]||"")&&(parts.length===2||(parts.length===3&&tail.includes(parts[2]))))return "https://www.youtube.com/channel/"+parts[1];
      let alias:string|null=null;
      if(parts[0]?.startsWith("@")&&(parts.length===1||(parts.length===2&&tail.includes(parts[1]))))alias=parts[0];
      if(["c","user"].includes(parts[0])&&parts[1]&&(parts.length===2||(parts.length===3&&tail.includes(parts[2]))))alias=parts[0]+"/"+parts[1];
      if(alias){
        const decoded=decodeURIComponent(alias),name=decoded.startsWith("@")?decoded.slice(1):decoded.split("/")[1];
        if(!/^[\p{L}\p{N}_.-]{1,100}$/u.test(name)||decoded.split("/").length!==alias.split("/").length)throw Error("INVALID_LINK");
        return "https://www.youtube.com/"+alias;
      }
    }
  } else throw Error("INVALID_HOST");
  if(!vid.test(id||""))throw Error("INVALID_LINK");
  return "https://www.youtube.com/watch?v="+id;
}
function share(text:string){
  if(typeof text!=="string"||text.length>20000)throw Error("INVALID_LINK");
  const found=new Set<string>();
  for(const m of text.match(/https?:\/\/[^\s<>"']+/gi)||[]){try{found.add(canonicalize(m.replace(/[),;\]]+$/,"")));}catch{}}
  if(!found.size)found.add(canonicalize(text.trim()));
  if(found.size!==1)throw Error("ONE_LINK_ONLY"); return [...found][0];
}
function htmlText(value:string){
  return safeNote(value.replace(/&amp;/gi,"&").replace(/&#39;|&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/&lt;/gi,"<").replace(/&gt;/gi,">"));
}
function metaContent(html:string,key:string){
  const wanted=key.toLowerCase();
  for(const tag of html.match(/<meta\b[^>]*>/gi)||[]){
    const lower=tag.toLowerCase();
    const named=lower.includes('property="'+wanted+'"')||lower.includes("property='"+wanted+"'")||lower.includes('name="'+wanted+'"')||lower.includes("name='"+wanted+"'");
    if(!named)continue;
    const m=tag.match(/\bcontent=["']([^"']+)["']/i);if(m)return htmlText(m[1]);
  }
  return "";
}
function safeThumbnail(raw:string){
  try{
    const u=new URL(htmlText(raw));const h=u.hostname.toLowerCase();
    return u.protocol==="https:"&&!u.username&&!u.password&&!u.port&&SAFE_IMAGE_HOSTS.has(h)?u.href:"";
  }catch{return "";}
}
function safeYoutubePage(raw:string,base?:string){
  const u=base?new URL(raw,base):new URL(raw);
  const h=u.hostname.toLowerCase();
  if(u.protocol!=="https:"||u.username||u.password||u.port||!YOUTUBE_PAGE_HOSTS.has(h))throw Error("INVALID_YOUTUBE_REDIRECT");
  return u;
}
async function fetchYoutubePage(raw:string,signal:AbortSignal){
  let current=safeYoutubePage(raw);
  for(let redirects=0;redirects<=3;redirects++){
    const r=await fetch(current,{redirect:"manual",signal,headers:{"User-Agent":"Mozilla/5.0","Accept-Language":"he,en;q=0.8"}});
    if(r.status<300||r.status>=400)return r;
    if(redirects===3)throw Error("TOO_MANY_YOUTUBE_REDIRECTS");
    const location=r.headers.get("location");if(!location)throw Error("INVALID_YOUTUBE_REDIRECT");
    current=safeYoutubePage(location,current.href);
  }
  throw Error("INVALID_YOUTUBE_REDIRECT");
}
function providerTarget(raw:string){
  if(typeof raw!=="string"||raw.length>24000)throw Error("INVALID_PROVIDER");
  const u=new URL(raw);
  if(u.protocol!=="https:"||u.username||u.password||u.port||!PROVIDER_ORIGINS.has(u.origin))throw Error("INVALID_PROVIDER");
  const q=[...u.searchParams.keys()];
  if(/^\/api\/v1\/videos\/[A-Za-z0-9_-]{11}$/.test(u.pathname)&&q.length===0)return u;
  if(/^\/api\/v1\/channels\/UC[A-Za-z0-9_-]{22}$/.test(u.pathname)&&q.length===0)return u;
  if(/^\/api\/v1\/channels\/UC[A-Za-z0-9_-]{22}\/videos$/.test(u.pathname)){
    if(q.some(k=>k!=="continuation")||u.searchParams.getAll("continuation").length>1||(u.searchParams.get("continuation")||"").length>20000)throw Error("INVALID_PROVIDER");
    return u;
  }
  if(u.pathname==="/api/v1/resolveurl"&&q.length===1&&q[0]==="url"){
    const approved=canonicalize(u.searchParams.get("url")||"");
    if(new URL(approved).searchParams.has("v"))throw Error("INVALID_PROVIDER");
    u.searchParams.set("url",approved);return u;
  }
  throw Error("INVALID_PROVIDER");
}
async function proxyProvider(raw:string,origin:string|null){
  let target:URL;try{target=providerTarget(raw);}catch{return json({error:"INVALID_PROVIDER"},400,origin);}
  try{
    return await timed(PROVIDER_TIMEOUT_MS,async signal=>{
      const r=await fetch(target,{redirect:"manual",signal,headers:{"Accept":"application/json","User-Agent":"KidsYouTubeParent/1.0"}});
      if(r.status>=300&&r.status<400)return providerFailure("UPSTREAM_REDIRECT",502,origin);
      if(!r.ok){
        const mapped=r.status===401||r.status===403?403:r.status===429?429:502;
        return providerFailure("UPSTREAM_UNAVAILABLE",mapped,origin);
      }
      if(oversized(r,MAX_PROVIDER_BYTES))return providerFailure("UPSTREAM_TOO_LARGE",502,origin);
      let text:string;try{text=await readBounded(r.body,MAX_PROVIDER_BYTES);}catch(e){if(signal.aborted)throw e;if(e instanceof Error&&e.message==="TOO_LARGE")return providerFailure("UPSTREAM_TOO_LARGE",502,origin);throw e;}
      try{JSON.parse(text);}catch{return providerFailure("UPSTREAM_INVALID",502,origin);}
      return new Response(text,{status:200,headers:{...cors(origin),"Content-Type":"application/json; charset=utf-8"}});
    });
  }catch(e){
    const timedOut=e!==null&&typeof e==="object"&&"name" in e&&e.name==="AbortError";
    return providerFailure(timedOut?"UPSTREAM_TIMEOUT":"UPSTREAM_UNAVAILABLE",timedOut?504:502,origin);
  }
}
function safeNote(v:unknown){return String(v||"").replace(/[\r\n\uFEFF]/g," ").replace(/\s+/g," ").trim().slice(0,500);}
function splitEntry(line:string){
  const value=line.replace(/^\uFEFF/,"").trim(), parts=value.split(/\s+\/\//,2);
  return {url:canonicalize(parts[0]),note:safeNote(parts[1]||"")};
}
function validateList(raw:unknown){
  if(typeof raw!=="string"||raw.length>1000000||raw.replace(/^\uFEFF/,"").trimStart().startsWith("{"))throw Error("INVALID_LIST");
  const seen=new Set<string>(),out:string[]=[];
  for(const line of raw.replace(/^\uFEFF/,"").split(/\r?\n/)){
    const value=line.trim(); if(!value||value.startsWith("//"))continue;
    const entry=splitEntry(value); if(seen.has(entry.url))continue; seen.add(entry.url);
    out.push(entry.url+(entry.note?" // "+entry.note:""));
  }
  return out.length?out.join("\n")+"\n":"";
}
async function metadata(input:string){
  const url=canonicalize(input), u=new URL(url), id=u.searchParams.get("v");
  if(id){
    const endpoint="https://www.youtube.com/oembed?url="+encodeURIComponent(url)+"&format=json";
    try{
      return await timed(METADATA_TIMEOUT_MS,async signal=>{
        const r=await fetch(endpoint,{signal,redirect:"manual",headers:{"Accept":"application/json","User-Agent":"KidsYouTubeParent/1.0"}});
        if(r.ok){
          if(oversized(r,1000000))throw Error("OEMBED_TOO_LARGE");
          const d=JSON.parse(await readBounded(r.body,1000000));
          return {url,kind:"video",id,title:safeNote(d.title)||"סרטון YouTube",author:safeNote(d.author_name),thumbnail:"https://img.youtube.com/vi/"+id+"/hqdefault.jpg"};
        }
        return {url,kind:"video",id,title:"סרטון YouTube",author:"",thumbnail:"https://img.youtube.com/vi/"+id+"/hqdefault.jpg"};
      });
    }catch{return {url,kind:"video",id,title:"סרטון YouTube",author:"",thumbnail:"https://img.youtube.com/vi/"+id+"/hqdefault.jpg"};}
  }
  let title="",thumbnail="";
  try{
    await timed(METADATA_TIMEOUT_MS,async signal=>{
      const r=await fetchYoutubePage(url,signal);
      if(!r.ok||oversized(r,MAX_YOUTUBE_HTML_BYTES))return;
      let html:string;try{html=await readBounded(r.body,MAX_YOUTUBE_HTML_BYTES);}catch{return;}
      title=metaContent(html,"og:title");
      if(!title){const m=html.match(/<title>([^<]+)<\/title>/i);if(m)title=htmlText(m[1]);}
      title=safeNote(title.replace(/\s*-\s*YouTube\s*$/i,""));
      thumbnail=safeThumbnail(metaContent(html,"og:image"));
      if(!thumbnail){
        const m=html.match(/"avatar"\s*:\s*\{\s*"thumbnails"\s*:\s*\[\s*\{\s*"url"\s*:\s*"([^"]+)"/i);
        if(m){try{thumbnail=safeThumbnail(JSON.parse('"'+m[1]+'"'));}catch{}}
      }
    });
  }catch{}
  return {url,kind:"channel",id:null,title:title||url.split("/").pop()||"ערוץ YouTube",author:"",thumbnail};
}
// Display catalog is a shared performance cache, NEVER an approval authority.
// Every catalog read is filtered by the latest authoritative state.
const CATALOG_TABLE = BASE+"/rest/v1/kids_youtube_catalog";
const PREPARE_TIMEOUT_MS = 12500;
const PAGE_MAX_ITEMS = 45;
const lastFeedAttempt = new Map<string,number>();
async function catalogReadThrough(rows:any[],snapshot:any){
  // Only the first missing page of one currently approved UC channel may be
  // prepared, synchronously, under 1.9s. No background work, no cron.
  const now=Date.now();
  const row=rows.find(v=>v?.kind==="channel"&&/^UC[A-Za-z0-9_-]{22}$/.test(v.item_id)
    &&(!Array.isArray(v.page)||v.page.length===0)
    &&now-Date.parse(v.checked_at||"")>20*60*1000
    &&now-(lastFeedAttempt.get(v.approval_url)||0)>20*60*1000);
  if(!row)return rows;
  lastFeedAttempt.set(row.approval_url,now);
  const feed=await youtubeFeedPage(row.item_id,Date.now()+1800);
  if(!feed?.videos?.length)return rows;
  const page=feed.videos.slice(0,20).map((v:any)=>safePreparedVideo(v,row.item_id)).filter(Boolean);
  if(!page.length)return rows;
  try{
    const latest=await state();
    if(latest.version!==snapshot.version||!approvedCatalogUrls(latest.list_text).has(row.approval_url))return rows;
    const updated={...row,page,continuation:null,pages_loaded:1,complete:false,checked_at:new Date().toISOString(),updated_at:new Date().toISOString()};
    await saveCatalog(updated);
    return rows.map(v=>v.approval_url===row.approval_url?updated:v);
  }catch{return rows;}
}
function approvedCatalogUrls(list:string):Set<string>{return existingUrls(list);}
async function catalogRows(approved:Set<string>){
  if(!approved.size)return [];
  return timed(STATE_TIMEOUT_MS,async signal=>{
    const url=CATALOG_TABLE+"?select=approval_url,kind,item_id,title,thumbnail,published,channel_id,page,continuation,pages_loaded,complete,updated_at,checked_at&limit=500";
    const r=await fetch(url,{signal,headers:{apikey:SERVICE,Authorization:"Bearer "+SERVICE}});
    if(!r.ok)throw Error("CATALOG_UNAVAILABLE");
    const rows=await r.json();
    if(!Array.isArray(rows))throw Error("CATALOG_INVALID");
    return rows.filter((v:any)=>v&&typeof v.approval_url==="string"&&approved.has(v.approval_url)).slice(0,250);
  });
}
async function saveCatalog(row:any){
  const r=await timed(STATE_TIMEOUT_MS,signal=>fetch(CATALOG_TABLE+"?on_conflict=approval_url",{
    method:"POST",signal,headers:{apikey:SERVICE,Authorization:"Bearer "+SERVICE,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates,return=minimal"},
    body:JSON.stringify(row)
  }));
  if(!r.ok)throw Error("CATALOG_SAVE_FAILED");
}
function safePreparedVideo(video:any,channelId:string){
  const id=String(video?.videoId||"");
  if(!/^[A-Za-z0-9_-]{11}$/.test(id))return null;
  const author=String(video?.authorId||"");
  if(author!==channelId)return null;
  const thumbnail="https://img.youtube.com/vi/"+id+"/hqdefault.jpg";
  return {id,videoId:id,title:safeNote(video.title)||"סרטון YouTube",author:safeNote(video.author),authorId:channelId,
    published:Number.isSafeInteger(video.published)&&video.published>0?video.published:0,thumbnail};
}
async function providerData(path:string,deadline=Date.now()+PREPARE_TIMEOUT_MS){
  for(const host of PROVIDER_ORIGINS){
    try{
      const remaining=Math.min(PROVIDER_TIMEOUT_MS,deadline-Date.now());
      if(remaining<100)return null;
      const target=providerTarget(host+path);
      const data=await timed(remaining,async signal=>{
        const r=await fetch(target,{signal,redirect:"manual",headers:{"Accept":"application/json"}});
        if(!r.ok||oversized(r,MAX_PROVIDER_BYTES))throw Error("PROVIDER_DOWN");
        return JSON.parse(await readBounded(r.body,MAX_PROVIDER_BYTES));
      });
      if(data&&typeof data==="object"&&!Array.isArray(data))return data;
    }catch{} // Next allowlisted provider; never expose upstream errors to children.
  }
  return null;
}
async function stableChannelId(url:string,deadline=Date.now()+PREPARE_TIMEOUT_MS){
  const match=url.match(/^https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})$/);
  if(match)return match[1];
  // An already-approved exact URL with a previously resolved pinned UC id
  // must not be silently retargeted when @handle changes or a provider fails.
  const saved=(await catalogRows(new Set([url])))[0];
  if(saved?.kind==="channel" && /^UC[A-Za-z0-9_-]{22}$/.test(saved.item_id))return saved.item_id;
  const data=await providerData("/api/v1/resolveurl?url="+encodeURIComponent(url),deadline);
  const id=data?.ucid||data?.browseId||"";
  return /^UC[A-Za-z0-9_-]{22}$/.test(id)?id:"";
}
function xmlValue(xml:string,tag:string){
  // The caller supplies fixed XML tag names only, never user input.
  const open="<"+tag+">",close="</"+tag+">";
  const start=xml.indexOf(open);
  if(start<0)return "";
  const end=xml.indexOf(close,start+open.length);
  return end<0?"":htmlText(xml.slice(start+open.length,end));
}
// Public YouTube channel feed: a bounded, key-free first-page fallback, not
// YouTube Data API and not an authorization source.
async function youtubeFeedPage(channelId:string,deadline:number){
  if(!/^UC[A-Za-z0-9_-]{22}$/.test(channelId))return null;
  try{
    return await timed(Math.min(3500,Math.max(1,deadline-Date.now())),async signal=>{
      const u="https://www.youtube.com/feeds/videos.xml?channel_id="+channelId;
      const r=await fetch(u,{signal,redirect:"manual",headers:{"Accept":"application/atom+xml, application/xml"}});
      if(!r.ok||oversized(r,500000))return null;
      const xml=await readBounded(r.body,500000);
      const feedChannelId=xmlValue(xml,"yt:channelId");
      // YouTube's Atom feed may omit the conventional UC prefix in yt:channelId.
      // Match the whole immutable ID in either documented observed encoding;
      // never infer an approval or use the feed as an authorization source.
      if(feedChannelId!==channelId && "UC"+feedChannelId!==channelId)return null;
      const entries=xml.match(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi)||[];
      const videos=[];
      for(const block of entries.slice(0,20)){
        const id=xmlValue(block,"yt:videoId");
        if(!/^[A-Za-z0-9_-]{11}$/.test(id))continue;
        const published=Date.parse(xmlValue(block,"published"));
        videos.push({videoId:id,authorId:channelId,title:xmlValue(block,"title"),
          author:xmlValue(xml,"title"),published:Number.isFinite(published)?Math.floor(published/1000):0});
      }
      return videos.length?{videos,continuation:null,feedFallback:true}:null;
    });
  }catch{return null;}
}
async function prepareCatalog(approvalUrl:string,requestedContinuation?:string|null){
  const deadline=Date.now()+PREPARE_TIMEOUT_MS;
  const current=await state();
  if(!approvedCatalogUrls(current.list_text).has(approvalUrl))throw Error("NOT_APPROVED");
  const now=new Date().toISOString(),videoId=new URL(approvalUrl).searchParams.get("v");
  if(videoId){
    const m=await metadata(approvalUrl);
    const extra=await providerData("/api/v1/videos/"+videoId,deadline);
    const row={approval_url:approvalUrl,kind:"video",item_id:videoId,
      title:safeNote(extra?.title||m.title)||"סרטון YouTube",
      thumbnail:m.thumbnail,published:Number.isSafeInteger(extra?.published)?extra.published:0,
      channel_id:/^UC[A-Za-z0-9_-]{22}$/.test(extra?.authorId||"")?extra.authorId:"",
      page:[],continuation:null,pages_loaded:0,complete:true,updated_at:now,checked_at:now};
    if(!approvedCatalogUrls((await state()).list_text).has(approvalUrl))return {prepared:false,reason:"REMOVED"};
    await saveCatalog(row);return {prepared:true,kind:"video"};
  }
  const id=await stableChannelId(approvalUrl,deadline);
  if(!id)return {prepared:false,reason:"CHANNEL_UNRESOLVED"};
  const saved=(await catalogRows(new Set([approvalUrl])))[0];
  const next=requestedContinuation===undefined?null:requestedContinuation;
  const same=saved?.item_id===id;
  if(next!==null&&(!same||saved?.continuation!==next||saved?.complete||saved?.pages_loaded>=8))
    throw Error("INVALID_CONTINUATION");
  const path="/api/v1/channels/"+id+"/videos"+(next?"?continuation="+encodeURIComponent(next):"");
  // Reserve a short, bounded window for the official RSS fallback and DB
  // commit. Trying all Invidious hosts to the outer deadline used to leave
  // no time to save even when another source succeeded.
  const providerDeadline=Math.min(deadline-4500,Date.now()+5400);
  const providerResult=await providerData(path,providerDeadline);
  const raw=providerResult&&Array.isArray(providerResult.videos)
    ? providerResult : (!next?await youtubeFeedPage(id,deadline):null);
  if(!raw||!Array.isArray(raw.videos))return {prepared:false,reason:"PROVIDER_UNAVAILABLE"};
  const fresh=raw.videos.slice(0,PAGE_MAX_ITEMS).map((v:any)=>safePreparedVideo(v,id)).filter(Boolean);
  const previous=same&&next ? (Array.isArray(saved.page)?saved.page:[]) : [];
  const seen=new Set<string>(),page:any[]=[];
  for(const v of [...previous,...fresh]){
    if(!v||seen.has(v.id))continue;seen.add(v.id);page.push(v);if(page.length>=8*PAGE_MAX_ITEMS)break;
  }
  const continuation=typeof raw.continuation==="string"&&raw.continuation.length<=20000?raw.continuation:null;
  const info=raw.feedFallback||deadline-Date.now()<1000?null:await providerData("/api/v1/channels/"+id,Math.min(deadline-400,Date.now()+1300));
  const thumbnail=safeThumbnail(Array.isArray(info?.authorThumbnails)?info.authorThumbnails.find((x:any)=>safeThumbnail(x?.url))?.url:"");
  const row={approval_url:approvalUrl,kind:"channel",item_id:id,title:safeNote(info?.author||saved?.title||"ערוץ YouTube"),
    thumbnail:thumbnail||safeThumbnail(saved?.thumbnail||""),published:0,channel_id:id,page,continuation,
    pages_loaded:Math.min(8,(next&&same?saved.pages_loaded:0)+1),complete:!raw.feedFallback&&!continuation,updated_at:now,checked_at:now};
  if(!approvedCatalogUrls((await state()).list_text).has(approvalUrl))return {prepared:false,reason:"REMOVED"};
  await saveCatalog(row);return {prepared:true,kind:"channel",count:page.length,complete:row.complete};
}

function existingUrls(raw:string){
  const out=new Set<string>(); for(const line of raw.replace(/^\uFEFF/,"").split(/\r?\n/)){const v=line.trim();if(!v||v.startsWith("//"))continue;try{out.add(canonicalize(v.split(/\s+\/\//,1)[0]));}catch{}}
  return out;
}
function edit(raw:string,op:string,url:string,note:string){
  if(typeof raw!=="string"||raw.length>1000000)throw Error("INVALID_LIST"); const urls=existingUrls(raw);
  if(op==="add"){if(urls.has(url))return raw;const n=safeNote(note);return raw+(raw&&!raw.endsWith("\n")?"\n":"")+url+(n?" // "+n:"")+"\n";}
  if(op!=="remove")throw Error("INVALID_OPERATION");
  return raw.split("\n").filter(line=>{const v=line.replace(/^\uFEFF/,"").trim();if(!v||v.startsWith("//"))return true;try{return canonicalize(v.split(/\s+\/\//,1)[0])!==url;}catch{return true;}}).join("\n");
}

Deno.serve(async(req)=>{
  const origin=req.headers.get("origin");
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin)});
  if(origin && !ALLOWED_ORIGINS.has(origin))return json({error:"ORIGIN_DENIED"},403,origin);
  try{
    const url=new URL(req.url), action=url.searchParams.get("action")||"list", s=await state();
    if(req.method==="GET"&&action==="provider"){
      if(!await auth(req,s))return json({error:"UNAUTHORIZED"},401,origin);
      return proxyProvider(url.searchParams.get("target")||"",origin);
    }
    if(req.method==="GET"&&action==="catalog"){
      const allowed=approvedCatalogUrls(s.list_text);
      try{
        const entries=await catalogRows(allowed);
        const ready=await catalogReadThrough(entries,s);
        return json({version:s.version,updatedAt:s.updated_at,entries:ready},200,origin);
      }catch{return json({version:s.version,updatedAt:s.updated_at,entries:[],available:false},200,origin);}
    }
    if(req.method==="GET"&&action==="list"){
      const format=url.searchParams.get("format");
      if(format==="text")return new Response(s.list_text,{status:200,headers:{...cors(origin),"Content-Type":"text/plain; charset=utf-8"}});
      if(format==="native"){
        // Single coherent parent-state snapshot and server-pinned channel mapping.
        // Missing catalog means no alias grants; direct video/UC approvals remain.
        const pins:any[]=[];
        let preparedCatalog:any=null;
        try{
          const approved=approvedCatalogUrls(s.list_text);
          // The pins and the optional display cache come from the SAME
          // already-performed catalog query. No extra HTTP connection, no
          // provider scraping and no dependency of approval on metadata.
          const rows=await catalogRows(approved);
          for(const row of rows){
            if(row.kind!=="channel"||!/^UC[A-Za-z0-9_-]{22}$/.test(row.item_id))continue;
            const time=Date.parse(row.checked_at||"");
            if(!Number.isFinite(time)||time>Date.now()+300000)continue;
            if(!/^https:\/\/www\.youtube\.com\/(?:@|c\/|user\/)/.test(row.approval_url))continue;
            pins.push({url:row.approval_url,id:row.item_id});
          }
          const candidate={version:s.version,updatedAt:s.updated_at,entries:rows};
          // The native list endpoint has a bounded 1 MB response contract.
          // A large catalog is optional and must never prevent fresh grants.
          if(JSON.stringify(candidate).length<=400000)preparedCatalog=candidate;
        }catch{}
        return json({list:s.list_text,version:s.version,updatedAt:s.updated_at,catalogVersion:1,pinnedChannels:pins,...(preparedCatalog?{preparedCatalog}:{})},200,origin);
      }
      return json({list:s.list_text,version:s.version,updatedAt:s.updated_at,catalogVersion:1,setupRequired:!s.password_hash},200,origin);
    }
    if(req.method!=="POST")return json({error:"METHOD"},405,origin);
    const declared=Number(req.headers.get("content-length")||0);
    if(Number.isFinite(declared)&&declared>MAX_BODY_BYTES)return json({error:"TOO_LARGE"},413,origin);
    let body:any={},rawBody:string;
    try{rawBody=await readBounded(req.body,MAX_BODY_BYTES);}
    catch{return json({error:"TOO_LARGE"},413,origin);}
    try{body=rawBody?JSON.parse(rawBody):{};}
    catch{return json({error:"BAD_JSON"},400,origin);}
    if(body===null||typeof body!=="object"||Array.isArray(body))return json({error:"BAD_JSON"},400,origin);
    if(action==="setup"){
      if(s.password_hash)return json({error:"ALREADY_SETUP"},409,origin);
      const password=typeof body.password==="string"?body.password:"";
      if(password.length<4||password.length>128)return json({error:"BAD_PASSWORD"},400,origin);
      const hash=await passwordHash(password,s.session_secret);
      if(!await patch(s.version,{password_hash:hash}))return json({error:"RETRY"},409,origin);
      return json({token:await makeToken(s.session_secret,90)},200,origin);
    }
    if(action==="login"){
      if(!s.password_hash)return json({error:"SETUP_REQUIRED"},409,origin);
      const password=typeof body.password==="string"?body.password:"";
      const hash=await passwordHash(password,s.session_secret);
      if(!constantTime(hash,s.password_hash))return json({error:"WRONG_PASSWORD"},401,origin);
      return json({token:await makeToken(s.session_secret,body.remember===false?0.5:90)},200,origin);
    }
    if(action==="metadata"){
      if(!await auth(req,s))return json({error:"UNAUTHORIZED"},401,origin);
      try{return json(await metadata(body.link||""),200,origin);}catch{return json({error:"INVALID_LINK"},400,origin);}
    }
    if(action==="prepare"){
      if(!await auth(req,s))return json({error:"UNAUTHORIZED"},401,origin);
      let approvalUrl:string;try{approvalUrl=canonicalize(body.link||"");}catch{return json({error:"INVALID_LINK"},400,origin);}
      if(!approvedCatalogUrls(s.list_text).has(approvalUrl))return json({error:"NOT_APPROVED"},403,origin);
      try{
        const result=await timed(PREPARE_TIMEOUT_MS,()=>prepareCatalog(approvalUrl,body.continuation));
        return json(result,200,origin);
      }catch{return json({prepared:false,error:"PREPARATION_UNAVAILABLE"},200,origin);}
    }
    if(action==="replace"){
      if(!await auth(req,s))return json({error:"UNAUTHORIZED"},401,origin);
      let replacement:string; try{replacement=validateList(body.list);}catch{return json({error:"INVALID_LIST"},400,origin);}
      // Whole-list replacement is NOT automatically rebased onto a newer state.
      // Its caller must have fetched precisely the version it is replacing.
      if(!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0)return json({error:"EXPECTED_VERSION_REQUIRED"},400,origin);
      if(body.expectedVersion!==s.version)return json({error:"CONFLICT",version:s.version},409,origin);
      if(replacement===s.list_text)return json({ok:true,changed:false,list:s.list_text,version:s.version},200,origin);
      if(!await patch(s.version,{list_text:replacement}))return json({error:"CONFLICT"},409,origin);
      return json({ok:true,changed:true,list:replacement,version:s.version+1},200,origin);
    }
    if(action==="mutate"){
      if(!await auth(req,s))return json({error:"UNAUTHORIZED"},401,origin);
      const op=body.operation, note=safeNote(body.note);
      if(op!=="add"&&op!=="remove")return json({error:"INVALID_OPERATION"},400,origin);
      let url2:string;try{url2=share(body.link||"");}catch{return json({error:"INVALID_LINK"},400,origin);}
      // Newly approved @handles are pinned to a UC identifier if a trusted
      // provider can resolve them. Existing grants are left untouched.
      const originalUrl=url2;
      if(op==="add"&&!new URL(url2).searchParams.has("v")&&!url2.includes("/channel/")
          &&!existingUrls(s.list_text).has(url2)){
        try{
          const id=await stableChannelId(url2);
          if(id)url2="https://www.youtube.com/channel/"+id;
        }catch{} // Never infer an identity from an expired local alias.
      }
      for(let i=0;i<3;i++){
        const fresh=i?await state():s; const updated=edit(fresh.list_text,op,url2,note);
        if(updated===fresh.list_text)return json({ok:true,changed:false,list:fresh.list_text,version:fresh.version},200,origin);
        if(await patch(fresh.version,{list_text:updated})){
          let prepared:any={prepared:false,reason:"NOT_REQUESTED"};
          if(op==="add"){
            try{prepared=await timed(PREPARE_TIMEOUT_MS,()=>prepareCatalog(url2));}catch{prepared={prepared:false,reason:"PREPARATION_UNAVAILABLE"};}
          }
          return json({ok:true,changed:true,list:updated,version:fresh.version+1,approvalUrl:url2,pinned:op==="add"&&url2!==originalUrl,catalog:prepared},200,origin);
        }
      }
      return json({error:"CONFLICT"},409,origin);
    }
    if(action==="status")return json({authenticated:await auth(req,s),setupRequired:!s.password_hash},200,origin);
    return json({error:"NOT_FOUND"},404,origin);
  }catch(e){return json({error:"FAILED"},500,origin);}
});