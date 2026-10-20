// SPDX-License-Identifier: GPL-3.0-or-later
// Inactive prototype: do not expose over HTTP before real Supabase Auth verification.
// A trusted server must resolve this principal; client JSON cannot supply identity.
'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_ID='legacy-singleton';
function failure(code){return Object.assign(new Error(code),{code});}
function validPrincipal(principal){
 if(!principal||principal.verified!==true||!UUID.test(principal.userId||'')||
   !UUID.test(principal.familyId||'')||
   !['parent','device'].includes(principal.role))throw failure('UNAUTHORIZED');
 if(principal.revoked===true)throw failure('REVOKED');
 return principal;
}
/**
 * Adapter methods must perform real, authoritative, same-family SQL operations.
 * compareAndSwap MUST be a single conditional UPDATE ... WHERE version=? and return
 * one affected row; read/authorization must never trust a familyId from HTTP input.
 */
function createFamilyGateway(adapter){
 if(!adapter||typeof adapter.read!=='function'||typeof adapter.compareAndSwap!=='function')
   throw TypeError('INVALID_ADAPTER');
 return Object.freeze({
  async read(verifiedPrincipal){
   const principal=validPrincipal(verifiedPrincipal);
   const row=await adapter.read(principal.familyId);
   if(!row)throw failure('NOT_FOUND');
   return {list:row.list,version:row.version};
  },
  async replace(verifiedPrincipal,{list,expectedVersion}={}){
   const principal=validPrincipal(verifiedPrincipal);
   if(principal.role!=='parent')throw failure('FORBIDDEN');
   if(typeof list!=='string'||list.length>1000000||
     !Number.isSafeInteger(expectedVersion)||expectedVersion<1)throw failure('INVALID_REQUEST');
   const row=await adapter.compareAndSwap(principal.familyId,expectedVersion,list);
   if(!row)throw failure('CONFLICT');
   return {list:row.list,version:row.version};
  }
 });
}
module.exports={createFamilyGateway,validPrincipal,LEGACY_ID};
