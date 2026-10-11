const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
const start=source.indexOf("function scheduleCatalogRetry(reason='partial')");
const end=source.indexOf("\nasync function retryCatalogContents()",start);
assert.ok(start>0&&end>start,'recovery scheduler not found');
const implementation=source.slice(start,end);
function fixture(){
  const scheduled=[],loads=[],debug=[];
  const context=vm.createContext({
    setTimeout: (fn,ms)=>{const id={fn,ms};scheduled.push(id);return id;},
    clearTimeout:()=>{},navigator:{onLine:false},document:{hidden:false},
    debugCatalog:(...args)=>debug.push(args),
    playback:null,loading:false,paginationBusy:false,approvalMarker:'',
    displayed:new Map(),retryCatalogContents:()=>{throw Error('unexpected partial retry');},
    loadApp:args=>{loads.push(args);},
    catalogMetrics:{retries:0}
  });
  vm.runInContext(`
    let catalogRetryTimer=null,catalogRetryAttempts=0,catalogRetryPending=false;
  `+implementation,context);
  return {context,scheduled,loads,debug,
    schedule:(reason='authorization')=>vm.runInContext('scheduleCatalogRetry('+JSON.stringify(reason)+')',context),
    attempts:()=>vm.runInContext('catalogRetryAttempts',context),
    pending:()=>vm.runInContext('catalogRetryPending',context)};
}
test('DNS recovery scheduler does not stop after three failures or flood overlapping timers',()=>{
  const f=fixture(),delays=[];
  for(let i=0;i<8;i++){
    f.schedule();f.schedule(); // Two triggers still produce just one scheduled retry.
    assert.equal(f.scheduled.length,1);
    const entry=f.scheduled.shift();delays.push(entry.ms);entry.fn();
  }
  assert.deepEqual(delays,[6000,18000,45000,90000,180000,180000,180000,180000]);
  assert.equal(f.loads.length,8);
  assert.equal(f.context.catalogMetrics.retries,8);
  assert.equal(f.attempts(),5); // stage counter cannot grow without bound
});
test('navigator connectivity flag does not permanently disable fresh HTTPS recovery',()=>{
  const f=fixture();
  assert.equal(f.context.navigator.onLine,false);
  f.schedule();
  assert.equal(f.scheduled.length,1);
  f.scheduled.shift().fn();
  assert.equal(f.loads.length,1);
  assert.equal(f.loads[0].trigger,'scheduled-authorization');
});
test('hidden screen defers authorization recovery instead of creating competing loads',()=>{
  const f=fixture();
  f.context.document.hidden=true;f.schedule();f.scheduled.shift().fn();
  assert.equal(f.loads.length,0);assert.equal(f.pending(),true);
});
test('fresh recovery can reset the backoff stage after a successful grant',()=>{
  const f=fixture();
  for(let i=0;i<5;i++){f.schedule();f.scheduled.shift().fn();}
  vm.runInContext('catalogRetryAttempts=0',f.context); // loadApp resets on fresh authorization
  f.schedule();assert.equal(f.scheduled[0].ms,6000);
});

test('optional metadata retries retain their original three-attempt cap',()=>{
  const f=fixture();
  for(let i=0;i<3;i++){
    f.schedule('partial');assert.equal(f.scheduled.length,1);
    f.scheduled.shift().fn();
  }
  f.schedule('partial');
  assert.equal(f.scheduled.length,0);
  assert.equal(f.attempts(),3);
});
