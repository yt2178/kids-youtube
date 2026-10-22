// SPDX-License-Identifier: GPL-3.0-or-later
// Staged, independent Supabase Auth family API. Not referenced by production clients.
// NEVER fall back to the legacy singleton or accept a family ID from the request.
const BASE=Deno.env.get("SUPABASE_URL")||"";
const SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const ALLOWED=new Set(["https://yt2178.github.io","https://appassets.androidplatform.net"]);
const TIMEOUT=9000;
function headers(origin:string|null){
 return {"Access-Control-Allow-Origin":ALLOWED.has(origin||"")?origin!:"https://yt2178.github.io",
 "Access-Control-Allow-Headers":"authorization, content-type","Access-Control-Allow-Methods":"GET,POST,OPTIONS",
 "Vary":"Origin","Cache-Control":"no-store","Content-Type":"application/json; charset=utf-8","X-Content-Type-Options":"nosniff"};
}
function response(data:unknown,status:number,origin:string|null){return new Response(JSON.stringify(data),{status,headers:headers(origin)});}
function fail(message:string,status:number):never{throw Object.assign(Error(message),{status});}
async function serviceRequest(path:string,init:RequestInit={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT);
 try{
  const res=await fetch(BASE+path,{...init,signal:controller.signal,redirect:"error",
   headers:{apikey:SERVICE,Authorization:"Bearer "+SERVICE,...init.headers}});
  if(!res.ok && res.status!==409)fail("STORAGE_UNAVAILABLE",503);
  return res;
 }finally{clearTimeout(timer);}
}
async function select(table:string,query:string){
 const res=await serviceRequest("/rest/v1/"+table+"?"+query);
 const rows=await res.json();
 if(!Array.isArray(rows))fail("STORAGE_UNAVAILABLE",503);
 return rows;
}
type Identity={id:string;isAnonymous:boolean;confirmed:boolean};
async function getUser(req:Request):Promise<Identity>{
 const authorization=req.headers.get("authorization")||"";
 if(!/^Bearer [A-Za-z0-9._-]{20,4000}$/.test(authorization))fail("UNAUTHORIZED",401);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT);
 try{
  const res=await fetch(BASE+"/auth/v1/user",{headers:{apikey:SERVICE,Authorization:authorization},
   signal:controller.signal,redirect:"error"});
  if(!res.ok)fail("UNAUTHORIZED",401);
  const user=await res.json();
  if(!user||typeof user.id!=="string"||!/^[a-f0-9-]{36}$/i.test(user.id))
   fail("UNAUTHORIZED",401);
  return {id:user.id,isAnonymous:user.is_anonymous===true,confirmed:!!(user.email_confirmed_at||user.confirmed_at)};
 }finally{clearTimeout(timer);}
}
async function getVerifiedEmail(req:Request){
 const auth=req.headers.get("authorization")||"";
 const response=await fetch(BASE+"/auth/v1/user",{headers:{apikey:SERVICE,Authorization:auth},redirect:"error"});
 if(!response.ok)return "";
 const profile=await response.json();
 if(!profile.email_confirmed_at&&!profile.confirmed_at)return "";
 return typeof profile.email==="string"?profile.email.trim():"";
}
async function principal(identity:Identity){
 // Anonymous identities are never parents. A device must be explicitly bound
 // in the database and not revoked, even when its Auth user is anonymous.
 if(!identity.isAnonymous&&identity.confirmed){
  const parents=await select("families","owner_id=eq."+encodeURIComponent(identity.id)+"&select=id&limit=1");
  if(parents.length===1)return {familyId:parents[0].id as string,role:"parent"};
 }
 const devices=await select("devices","auth_user_id=eq."+encodeURIComponent(identity.id)+"&revoked_at=is.null&select=family_id&limit=1");
 if(devices.length===1)return {familyId:devices[0].family_id as string,role:"device"};
 fail("NO_FAMILY",403);
}
async function readRow(familyId:string){
 const rows=await select("family_approvals","family_id=eq."+encodeURIComponent(familyId)+"&select=list_text,version&limit=1");
 if(rows.length!==1)fail("NOT_FOUND",404);
 return {list:rows[0].list_text,version:rows[0].version};
}
async function parseBody(req:Request){
 const size=Number(req.headers.get("content-length")||0);
 if(size>1100000)fail("TOO_LARGE",413);
 const raw=await req.text();if(raw.length>1100000)fail("TOO_LARGE",413);
 try{const value=JSON.parse(raw);if(!value||typeof value!=="object"||Array.isArray(value))throw Error();return value;}
 catch{fail("INVALID_JSON",400);}
}
function validateApprovalList(list:string){
 const seen=new Set<string>();
 for(const raw of list.split(/\r?\n/)){
  const line=raw.trim();if(!line||line.startsWith("//"))continue;
  const match=line.match(/^(\S+)(?:\s+\/\/.*)?$/);
  if(!match)fail("INVALID_APPROVALS",400);
  let u:URL;try{u=new URL(match[1]);}catch{fail("INVALID_APPROVALS",400);}
  if(u.protocol!=="https:"||!["youtube.com","www.youtube.com","youtu.be"].includes(u.hostname)||
    u.username||u.password||u.port||u.hash)fail("INVALID_APPROVALS",400);
  const path=u.pathname,keys=[...u.searchParams.keys()];
  const isWatch=(u.hostname!=="youtu.be"&&path==="/watch"&&keys.length===1&&keys[0]==="v"&&/^[A-Za-z0-9_-]{11}$/.test(u.searchParams.get("v")||""));
  const isShort=(u.hostname==="youtu.be"&&/^\/[A-Za-z0-9_-]{11}$/.test(path)&&keys.length===0);
  const isChannel=(u.hostname!=="youtu.be"&&/^\/channel\/UC[A-Za-z0-9_-]{22}$/.test(path)&&keys.length===0);
  const isHandle=(u.hostname!=="youtu.be"&&/^\/@[^/]{2,100}$/.test(path)&&keys.length===0);
  const isPlaylist=(u.hostname!=="youtu.be"&&path==="/playlist"&&keys.length===1&&keys[0]==="list"&&/^PL[A-Za-z0-9_-]{10,}$/.test(u.searchParams.get("list")||""));
  if(!(isWatch||isShort||isChannel||isHandle||isPlaylist)||seen.has(u.href))
   fail("INVALID_APPROVALS",400);
  seen.add(u.href);
  if(seen.size>2000)fail("TOO_MANY_APPROVALS",400);
 }
}

async function sha256hex(input:string){
 const data=new TextEncoder().encode(input);
 return [...new Uint8Array(await crypto.subtle.digest("SHA-256",data))].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function newPairCode(){
 const bytes=crypto.getRandomValues(new Uint8Array(12));
 return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}

Deno.serve(async req=>{
 const origin=req.headers.get("origin");
 if(origin&&!ALLOWED.has(origin))return response({error:"ORIGIN_DENIED"},403,origin);
 if(req.method==="OPTIONS")return response({},200,origin);
 try{
  if(!BASE.startsWith("https://")||!SERVICE)fail("NOT_CONFIGURED",503);
  const action=new URL(req.url).searchParams.get("action")||"list";
  if(!["list","replace","enroll","create-code","pair-device"].includes(action))fail("UNKNOWN_ACTION",404);
  const identity=await getUser(req);
  const userId=identity.id;
  if(action==="enroll"){
   // Public self-service enrolment is disabled until the pilot is approved.
   if(Deno.env.get("FAMILY_PILOT_ENROLL_ENABLED")!=="true")fail("ENROLLMENT_CLOSED",403);
   if(identity.isAnonymous||!identity.confirmed)fail("UNAUTHORIZED",401);
   if(Deno.env.get("FAMILY_PILOT_INVITES_READY")!=="true")fail("ENROLLMENT_CLOSED",403);
   const inviteEmail=String((await getVerifiedEmail(req))||"").toLowerCase();
   if(!inviteEmail)fail("INVITATION_REQUIRED",403);
   const invites=await select("family_pilot_invites","email=eq."+encodeURIComponent(inviteEmail)+"&used_at=is.null&expires_at=gt."+encodeURIComponent(new Date().toISOString())+"&select=email&limit=1");
   if(invites.length!==1)fail("INVITATION_REQUIRED",403);
   if(req.method!=="POST")fail("METHOD",405);
   // Account creation is deliberately not exposed here. Enrolment requires an
   // independently authenticated, confirmed, non-anonymous Supabase Auth user.
   // Existing family is returned idempotently.
   const existing=await select("families","owner_id=eq."+encodeURIComponent(userId)+"&select=id&limit=1");
   if(existing.length===1){
    // Repair a previous partial enrolment without modifying an existing list.
    const id=existing[0].id;
    await serviceRequest("/rest/v1/family_approvals",{method:"POST",
     headers:{"Content-Type":"application/json","Prefer":"resolution=ignore-duplicates,return=minimal"},
     body:JSON.stringify({family_id:id,list_text:"",version:1})});
    return response({created:false,familyId:id},200,origin);
   }
   const body=await parseBody(req);
   const name=typeof body.name==="string"?body.name.trim():"";
   if(name.length<1||name.length>80)fail("INVALID_NAME",400);
   const inserted=await serviceRequest("/rest/v1/families",{method:"POST",
    headers:{"Content-Type":"application/json","Prefer":"return=representation"},
    body:JSON.stringify({owner_id:userId,name})});
   if(inserted.status===409)fail("CONFLICT_RETRY",409);
   const rows=await inserted.json();
   if(!Array.isArray(rows)||rows.length!==1)fail("STORAGE_UNAVAILABLE",503);
   // An incomplete enrolment is recoverable: list will return NOT_FOUND, not fallback.
   const familyId=rows[0].id;
   await serviceRequest("/rest/v1/family_approvals",{method:"POST",
    headers:{"Content-Type":"application/json","Prefer":"return=minimal"},
    body:JSON.stringify({family_id:familyId,list_text:"",version:1})});
   return response({created:true,familyId},201,origin);
  }
  if(action==="pair-device"){
   if(req.method!=="POST")fail("METHOD",405);
   if(!identity.isAnonymous)fail("FORBIDDEN",403);
   // Existing devices cannot re-pair, including revoked devices.
   const already=await select("devices","auth_user_id=eq."+encodeURIComponent(userId)+"&select=id&limit=1");
   if(already.length)fail("ALREADY_PAIRED",409);
   const body=await parseBody(req);
   const code=typeof body.code==="string"?body.code.trim():"";
   const name=typeof body.name==="string"?body.name.trim():"";
   if(!/^[A-Za-z0-9_-]{16}$/.test(code)||name.length<1||name.length>80)
    fail("INVALID_REQUEST",400);
   const claimed=await serviceRequest("/rest/v1/rpc/claim_family_pairing",{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({p_code_hash:await sha256hex(code),p_device_user:userId,p_device_name:name})});
   const familyId=await claimed.json();
   if(typeof familyId!=="string"||!/^[a-f0-9-]{36}$/i.test(familyId))fail("PAIRING_DENIED",403);
   return response({paired:true},200,origin);
  }
  const who=await principal(identity);
  if(action==="create-code"){
   if(req.method!=="POST")fail("METHOD",405);
   if(who.role!=="parent")fail("FORBIDDEN",403);
   const code=newPairCode();
   const expires=new Date(Date.now()+10*60*1000).toISOString();
   await serviceRequest("/rest/v1/family_pair_codes?on_conflict=family_id",{method:"POST",
    headers:{"Content-Type":"application/json","Prefer":"resolution=merge-duplicates,return=minimal"},
    body:JSON.stringify({family_id:who.familyId,code_hash:await sha256hex(code),
     expires_at:expires,consumed_at:null})});
   return response({code,expiresAt:expires},200,origin);
  }
  if(action==="list"){
   if(req.method!=="GET")fail("METHOD",405);
   return response(await readRow(who.familyId),200,origin);
  }
  if(req.method!=="POST")fail("METHOD",405);
  if(who.role!=="parent")fail("FORBIDDEN",403);
  const body=await parseBody(req);
  if(typeof body.list!=="string"||body.list.length>1000000||
   !Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<1)fail("INVALID_REQUEST",400);
  validateApprovalList(body.list);
  // Both the family ID and old version are SQL equality predicates. Exactly one
  // row must match; a stale writer cannot overwrite another parent's change.
  const path="/rest/v1/family_approvals?family_id=eq."+encodeURIComponent(who.familyId)+
   "&version=eq."+body.expectedVersion;
  const updated=await serviceRequest(path,{method:"PATCH",headers:{"Content-Type":"application/json","Prefer":"return=representation"},
   body:JSON.stringify({list_text:body.list,version:body.expectedVersion+1,updated_at:new Date().toISOString()})});
  const rows=await updated.json();
  if(!Array.isArray(rows)||rows.length!==1)fail("VERSION_CONFLICT",409);
  return response({list:rows[0].list_text,version:rows[0].version},200,origin);
 }catch(e){
  const error=e as {status?:number;message?:string}|null;
  const status=typeof error?.status==="number"?error.status:503;
  return response({error:status===503?"SERVICE_UNAVAILABLE":String(error?.message||"FAILED")},status,origin);
 }
});
