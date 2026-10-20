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
async function getUser(req:Request){
 const authorization=req.headers.get("authorization")||"";
 if(!/^Bearer [A-Za-z0-9._-]{20,4000}$/.test(authorization))fail("UNAUTHORIZED",401);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT);
 try{
  const res=await fetch(BASE+"/auth/v1/user",{headers:{apikey:SERVICE,Authorization:authorization},
   signal:controller.signal,redirect:"error"});
  if(!res.ok)fail("UNAUTHORIZED",401);
  const user=await res.json();
  if(!user||!user.email_confirmed_at&&!user.confirmed_at||typeof user.id!=="string"||!/^[a-f0-9-]{36}$/i.test(user.id)||user.is_anonymous===true)
   fail("UNAUTHORIZED",401);
  return user.id as string;
 }finally{clearTimeout(timer);}
}
async function principal(userId:string){
 const parents=await select("families","owner_id=eq."+encodeURIComponent(userId)+"&select=id&limit=1");
 if(parents.length===1)return {familyId:parents[0].id as string,role:"parent"};
 const devices=await select("devices","auth_user_id=eq."+encodeURIComponent(userId)+"&revoked_at=is.null&select=family_id&limit=1");
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
Deno.serve(async req=>{
 const origin=req.headers.get("origin");
 if(origin&&!ALLOWED.has(origin))return response({error:"ORIGIN_DENIED"},403,origin);
 if(req.method==="OPTIONS")return response({},200,origin);
 try{
  if(!BASE.startsWith("https://")||!SERVICE)fail("NOT_CONFIGURED",503);
  const action=new URL(req.url).searchParams.get("action")||"list";
  if(!["list","replace","enroll"].includes(action))fail("UNKNOWN_ACTION",404);
  const userId=await getUser(req);
  if(action==="enroll"){
   if(req.method!=="POST")fail("METHOD",405);
   // Account creation is deliberately not exposed here. Enrolment requires an
   // independently authenticated, confirmed, non-anonymous Supabase Auth user.
   // Existing family is returned idempotently.
   const existing=await select("families","owner_id=eq."+encodeURIComponent(userId)+"&select=id&limit=1");
   if(existing.length===1){\n    // Repair a previous partial enrolment without modifying an existing list.\n    const id=existing[0].id;\n    await serviceRequest("/rest/v1/family_approvals",{method:"POST",\n     headers:{"Content-Type":"application/json","Prefer":"resolution=ignore-duplicates,return=minimal"},\n     body:JSON.stringify({family_id:id,list_text:"",version:1})});\n    return response({created:false,familyId:id},200,origin);\n   }
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
  const who=await principal(userId);
  if(action==="list"){
   if(req.method!=="GET")fail("METHOD",405);
   return response(await readRow(who.familyId),200,origin);
  }
  if(req.method!=="POST")fail("METHOD",405);
  if(who.role!=="parent")fail("FORBIDDEN",403);
  const body=await parseBody(req);
  if(typeof body.list!=="string"||body.list.length>1000000||
   !Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<1)fail("INVALID_REQUEST",400);
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
  const status=typeof e?.status==="number"?e.status:503;
  return response({error:status===503?"SERVICE_UNAVAILABLE":String(e?.message||"FAILED")},status,origin);
 }
});
