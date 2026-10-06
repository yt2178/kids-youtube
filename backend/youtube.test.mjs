import test from 'node:test';
import assert from 'node:assert/strict';
import { Platform } from 'youtubei.js';
import { boundedFetch } from './youtube.mjs';
test('supplier JavaScript interpreter cannot access Node, fetch or filesystem bindings',async()=>{
  const result=await Platform.shim.eval({output:'({node:typeof process,require:typeof require,network:typeof fetch})'});
  assert.deepEqual(result,{node:'undefined',require:'undefined',network:'undefined'});
});
test('supplier JavaScript infinite computation is interrupted',async()=>{
  await assert.rejects(Platform.shim.eval({output:'while(true){}'}));
});
test('HTTP authorization errors are classified separately from a confirmed player bot challenge',async t=>{
  const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
  for(const [status,code]of [[401,'UNAUTHORIZED'],[403,'FORBIDDEN'],[429,'RATE_LIMITED'],[500,'UPSTREAM_ERROR']]){
    globalThis.fetch=async()=>new Response('unavailable',{status});
    await assert.rejects(boundedFetch('https://www.youtube.com/test'),e=>e.code===code);
  }
});
