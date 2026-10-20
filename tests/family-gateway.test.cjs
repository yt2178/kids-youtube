const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createFamilyGateway}=require('../experiments/family-gateway.js');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const parentA={verified:true,userId:A,familyId:A,role:'parent'};
const parentB={verified:true,userId:B,familyId:B,role:'parent'};
function fixture(){
 const rows=new Map([[A,{list:'family A video',version:1}],[B,{list:'family B video',version:1}]]);
 const sessions=new Map([['parent-a',parentA],['parent-b',parentB],
  ['device-a',{verified:true,userId:A,familyId:A,role:'device'}],
  ['revoked-a',{verified:true,userId:A,familyId:A,role:'device',revoked:true}]]);
 const calls=[];
 const adapter={
  async read(id){calls.push(['read',id]);return rows.get(id)||null;},
  async compareAndSwap(id,version,list){calls.push(['cas',id,version]);const old=rows.get(id);if(!old||old.version!==version)return null;const next={list,version:version+1};rows.set(id,next);return next;}
 };
 const gateway=createFamilyGateway(adapter,async session=>sessions.get(session)||null);
 return {gateway,rows,calls};
}
test('parents are isolated, without any client family selection',async()=>{
 const {gateway,rows,calls}=fixture();
 assert.deepEqual(await gateway.read('parent-a'),{list:'family A video',version:1});
 assert.deepEqual(await gateway.read('parent-b'),{list:'family B video',version:1});
 await gateway.replace('parent-a',{list:'new A',expectedVersion:1,familyId:B});
 assert.equal(rows.get(A).list,'new A');assert.equal(rows.get(B).list,'family B video');
 assert.equal(calls.every(x=>x[1]===A||x[1]===B),true);
 assert.equal(calls.filter(x=>x[0]==='cas')[0][1],A);
});
test('devices cannot change approvals; revoked and anonymous sessions cannot read',async()=>{
 const {gateway,calls}=fixture();
 assert.equal((await gateway.read('device-a')).list,'family A video');
 await assert.rejects(gateway.replace('device-a',{list:'hack',expectedVersion:1}),{code:'FORBIDDEN'});
 await assert.rejects(gateway.read('revoked-a'),{code:'REVOKED'});
 await assert.rejects(gateway.read('not-logged-in'),{code:'UNAUTHORIZED'});
 assert.deepEqual(calls,[['read',A]]);
});
test('stale version and invalid payloads cannot overwrite approvals',async()=>{
 const {gateway,rows}=fixture();
 await assert.rejects(gateway.replace('parent-a',{list:'stale',expectedVersion:5}),{code:'CONFLICT'});
 await assert.rejects(gateway.replace('parent-a',{list:'bad',expectedVersion:0}),{code:'INVALID_REQUEST'});
 await assert.rejects(gateway.replace('parent-a',{list:[],expectedVersion:1}),{code:'INVALID_REQUEST'});
 assert.equal(rows.get(A).list,'family A video');
});
test('verified family identity cannot be passed directly as a session',async()=>{
 const {gateway}=fixture();
 await assert.rejects(gateway.read(parentA),{code:'UNAUTHORIZED'});
 assert.throws(()=>createFamilyGateway({read(){},compareAndSwap(){}}),/MISSING_VERIFIER/);
});
