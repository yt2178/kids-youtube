const WEB_ORIGIN = "https://yt2178.github.io";
const ANDROID_ORIGIN = "https://appassets.androidplatform.net";
const ALLOWED_ORIGINS = new Set([WEB_ORIGIN, ANDROID_ORIGIN]);
const BASE = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ROW = BASE + "/rest/v1/kids_youtube_state?singleton=eq.true&select=list_text,password_hash,session_secret,version,updated_at";

function cors(origin:string|null){
  const allowed = origin ? ALLOWED_ORIGINS.has(origin) : false;
  return {
    "Access-Control-Allow-Origin": allowed ? origin! : WEB_ORIGIN,
    "Access-Control-Allow-Headers":"authorization, content-type",
    "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
    "Vary":"Origin",
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store"
  };
}
function json(body:unknown,status=200,origin:string|null=null){return new Response(JSON.stringify(body),{status,headers:cors(origin)});}
function b64url(bytes:Uint8Array){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
function unb64url(s:string){s=s.replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";const raw=atob(s);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
async function sha256(text:string){return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text))));}
async function hmac(secret:string,text:string){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(text))));
}
function constantTime(a:string,b:string){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
async function state(){
  const r=await fetch(ROW,{headers:{apikey:SERVICE,Authorization:"Bearer "+SERVICE}});
  if(!r.ok)throw Error("STATE_READ");
  const a=await r.json(); if(!Array.isArray(a)||a.length!==1)throw Error("STATE_MISSING"); return a[0];
}
async function patch(expectedVersion:number, data:Record<string,unknown>){
  const url=BASE+"/rest/v1/kids_youtube_state?singleton=eq.true&version=eq."+expectedVersion;
  const r=await fetch(url,{method:"PATCH",headers:{apikey:SERVICE,Authorization:"Bearer "+SERVICE,"Content-Type":"application/json","Prefer":"return=representation"},body:JSON.stringify({...data,version:expectedVersion+1,updated_at:new Date().toISOString()})});
  if(!r.ok)throw Error("STATE_WRITE");
  const a=await r.json(); return Array.isArray(a)&&a.length===1;
}
async function passwordHash(password:string,secret:string){return sha256(secret+"\0"+password);}
async function makeToken(secret:string,days:number){
  const payload={exp:Date.now()+days*86400000,iat:Date.now(),v:1};
  const body=b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return body+"."+await hmac(secret,body);
}
async function auth(req:Request,s:any){
  const raw=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  const [body,sig]=raw.split(".");
  if(!body||!sig)return false;
  if(!constantTime(await hmac(s.session_secret,body),sig))return false;
  try{const p=JSON.parse(new TextDecoder().decode(unb64url(body)));return p&&p.v===1&&Number.isFinite(p.exp)&&p.exp>Date.now();}catch{return false;}
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
    const r=await fetch(endpoint,{headers:{"User-Agent":"KidsYouTubeParent/1.0"}});
    if(r.ok){const d=await r.json();return {url,kind:"video",id,title:safeNote(d.title)||"סרטון YouTube",author:safeNote(d.author_name),thumbnail:"https://img.youtube.com/vi/"+id+"/hqdefault.jpg"};}
    return {url,kind:"video",id,title:"סרטון YouTube",author:"",thumbnail:"https://img.youtube.com/vi/"+id+"/hqdefault.jpg"};
  }
  let title="";
  try{
    const r=await fetch(url,{redirect:"follow",headers:{"User-Agent":"Mozilla/5.0"}});
    if(r.ok){const html=await r.text();const m=html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']/i)||html.match(/<title>([^<]+)<\/title>/i);if(m)title=safeNote(m[1].replace(/&amp;/g,"&").replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s*-\s*YouTube\s*$/i,""));}
  }catch{}
  return {url,kind:"channel",id:null,title:title||url.split("/").pop()||"ערוץ YouTube",author:"",thumbnail:""};
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
    if(req.method==="GET"&&action==="list"){ if(url.searchParams.get("format")==="text") return new Response(s.list_text,{status:200,headers:{...cors(origin),"Content-Type":"text/plain; charset=utf-8"}}); return json({list:s.list_text,updatedAt:s.updated_at,setupRequired:!s.password_hash},200,origin); }
    if(req.method!=="POST")return json({error:"METHOD"},405,origin);
    const body=await req.json().catch(()=>({}));
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
    if(action==="replace"){
      if(!await auth(req,s))return json({error:"UNAUTHORIZED"},401,origin);
      let replacement:string; try{replacement=validateList(body.list);}catch{return json({error:"INVALID_LIST"},400,origin);}
      for(let i=0;i<3;i++){
        const fresh=i?await state():s;
        if(replacement===fresh.list_text)return json({ok:true,changed:false,list:fresh.list_text},200,origin);
        if(await patch(fresh.version,{list_text:replacement}))return json({ok:true,changed:true,list:replacement},200,origin);
      }
      return json({error:"CONFLICT"},409,origin);
    }
    if(action==="mutate"){
      if(!await auth(req,s))return json({error:"UNAUTHORIZED"},401,origin);
      const op=body.operation, url2=share(body.link||""), note=safeNote(body.note);
      for(let i=0;i<3;i++){
        const fresh=i?await state():s; const updated=edit(fresh.list_text,op,url2,note);
        if(updated===fresh.list_text)return json({ok:true,changed:false,list:fresh.list_text},200,origin);
        if(await patch(fresh.version,{list_text:updated}))return json({ok:true,changed:true,list:updated},200,origin);
      }
      return json({error:"CONFLICT"},409,origin);
    }
    if(action==="status")return json({authenticated:await auth(req,s),setupRequired:!s.password_hash},200,origin);
    return json({error:"NOT_FOUND"},404,origin);
  }catch(e){return json({error:"FAILED"},500,origin);}
});