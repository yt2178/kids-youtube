'use strict';
// Android-only entry point. WebMessageListener exposes this object only to our
// packaged HTTPS origin and only the main frame is accepted by the Activity.
(() => {
  const pending = new Map();
  let sequence = 0;
  const bridge = window.KidsAndroid;
  const error = code => Object.assign(new Error(code || 'VIDEO_UNAVAILABLE'), {code:code || 'VIDEO_UNAVAILABLE'});
  if (!bridge) throw error('NATIVE_BRIDGE_UNAVAILABLE');
  bridge.onmessage = event => {
    let message;
    try {message = JSON.parse(event.data);} catch (_) {return;}
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer);
    if (item.removeAbort) item.removeAbort();
    if (message.error) item.reject(error(message.error));
    else item.resolve(message.data);
  };
  function call(method, argument, signal, timeout = 15000) {
    return new Promise((resolve,reject) => {
      if (signal && signal.aborted) {reject(error('ABORTED'));return;}
      const id = String(++sequence);
      const finish = code => {
        const item = pending.get(id);
        if (!item) return;
        pending.delete(id);clearTimeout(item.timer);
        if (item.removeAbort) item.removeAbort();
        bridge.postMessage(JSON.stringify({method:'cancel',id}));
        reject(error(code));
      };
      const item = {resolve,reject,timer:setTimeout(()=>finish('TIMEOUT'),timeout)};
      if (signal) {const abort=()=>finish('ABORTED'); signal.addEventListener('abort',abort,{once:true});item.removeAbort=()=>signal.removeEventListener('abort',abort);}
      pending.set(id,item);
      try {bridge.postMessage(JSON.stringify({id,method,argument}));}
      catch (_) {finish('NATIVE_BRIDGE_UNAVAILABLE');}
    });
  }
  const realFetch = window.fetch.bind(window);
  const APPROVAL_API='https://jxhelpxhrmwvzrrfrjuh.supabase.co/functions/v1/kids-youtube';
  window.fetch = (input,options = {}) => {
    const raw = typeof input === 'string' ? input : input.url;
    const url = new URL(raw,location.href);
    if (url.origin===new URL(APPROVAL_API).origin && url.pathname===new URL(APPROVAL_API).pathname && url.searchParams.get('action')==='list') {
      return call('whitelist',null,options.signal).then(text => new Response(JSON.stringify({list:text}),{status:200,headers:{'Content-Type':'application/json; charset=utf-8'}}));
    }
    return realFetch(input,options);
  };
  function createManager() {
    const memory = new Map(), network = new WeakSet();
    return {
      request:async (path,options = {}) => {
        // Native code owns authorization and caching; never trust this map as a grant.
        const data = await call('api',path,options.signal);
        if (options.validate && !options.validate(data)) throw error('PROVIDER_ERROR');
        if (data && typeof data === 'object') network.add(data);
        return data;
      },
      isNetworkData:data=>network.has(data),
      getHealthyProviders:()=>[],
      healthCheck:()=>Promise.resolve(),
      snapshot:()=>({mode:'android-newpipe',health:{},network:'on-device'}),
      clearCache:()=>{memory.clear();call('clear',null).catch(()=>{});},
      resetHealth:()=>{},
      pauseProvider:()=>{},
      record:()=>{},
      updateProviderHealth:()=>{},
      markResourceFailure:()=>{},
      clearResourceFailures:()=>{},
      getCachedData:key=>memory.get(key),
      setCachedData:(key,value)=>memory.set(key,value),
      removeCachedData:key=>memory.delete(key)
    };
  }
  window.KidsNative = {
    createManager,
    openPlayer:id=>call('play',id,undefined,30000).catch(()=>{}),
    call
  };
  // Existing diagnostic controls are only for browser Invidious providers.
  document.addEventListener('DOMContentLoaded',()=>{
    const panel=document.getElementById('diagnostic-panel');
    if (panel) panel.remove();
  },{once:true});
})();
