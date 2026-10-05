/* Small transport/cache layer. No packages, private keys or public proxy. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KidsProviders = api;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  class AppError extends Error {
    constructor(code, status = 0) { super(code); this.name = 'AppError'; this.code = code; this.status = status; }
  }
  function classifyError(error) {
    if (error instanceof AppError) return error;
    if (error && error.name === 'AbortError') return new AppError('CANCELLED');
    // Browsers intentionally do not distinguish failed CORS from other network
    // failures. Never claim that a TypeError is proof of CORS specifically.
    return new AppError(error && error.name === 'SyntaxError' ? 'INVALID_RESPONSE' : 'NETWORK_OR_CORS');
  }
  function httpError(status) {
    return new AppError(({401:'UNAUTHORIZED',403:'FORBIDDEN',404:'NOT_FOUND',429:'RATE_LIMITED'})[status] || (status >= 500 ? 'PROVIDER_ERROR' : 'REQUEST_ERROR'), status);
  }
  async function fetchJSON(fetcher, url, {timeout = 4000, signal, format = 'json'} = {}) {
    if (signal && signal.aborted) throw new AppError('CANCELLED');
    const controller = new AbortController();
    let timer, cancel;
    const deadline = new Promise((_,reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new AppError('TIMEOUT')); }, timeout);
      cancel = () => { controller.abort(); reject(new AppError('CANCELLED')); };
      if (signal) { if (signal.aborted) cancel(); else signal.addEventListener('abort',cancel,{once:true}); }
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await fetcher(url, {cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
        if (!response.ok) throw httpError(response.status);
        return format === 'text' ? await response.text() : await response.json();
      })()]);
    } catch (error) { throw classifyError(error); }
    finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort',cancel); }
  }
  function createManager({instances, scope, fetcher, storage, clock = Date.now, timeout = 4000, budget = 12500, maxEntries = 300} = {}) {
    const bases = [...new Set(instances)].filter(base => {try {const u=new URL(base);return u.protocol==='https:' && u.origin===base && !u.username && !u.password;} catch (_) {return false;}});
    const healthKey = 'kidsYoutubeHealth:' + scope;
    const dataKey = 'kidsYoutubeData:' + scope;
    const networkData = new WeakSet();
    const dataProviders = new WeakMap();
    const inflight = new Map(), resourceFailures = new Map(), diagnostics = [];
    const load = key => {try {return JSON.parse(storage.getItem(key)) || {};} catch (_) {return {};}};
    const save = (key,value) => {try {storage.setItem(key,JSON.stringify(value));} catch (_) { /* Optional cache. */ }};
    const storedHealth = load(healthKey), storedData = load(dataKey);
    const cache = new Map();
    if (storedData && Array.isArray(storedData.entries)) for (const entry of storedData.entries.slice(-maxEntries)) {
      if (entry && typeof entry.key==='string' && entry.key.length<5000 && Number.isFinite(entry.expires) && entry.expires>clock() && entry.expires<clock()+24*60*60*1000) cache.set(entry.key, entry);
    }
    const states = Object.create(null);
    for (const base of bases) {
      states[base] = Object.create(null);
      for (const kind of ['api','playback']) {
        const old = storedHealth && storedHealth[base] && storedHealth[base][kind];
        const fresh = {status:'unknown',lastSuccess:0,lastFailure:0,failureCount:0,averageResponseTime:0,cooldownUntil:0};
        if (old && Number.isFinite(old.lastFailure) && Number.isFinite(old.lastSuccess) && Math.max(old.lastFailure,old.lastSuccess)>clock()-10*60*1000) {
          for (const key of ['lastSuccess','lastFailure','failureCount','averageResponseTime','cooldownUntil']) if (Number.isFinite(old[key]) && old[key]>=0) fresh[key]=Math.min(old[key], key==='cooldownUntil' ? clock()+5*60*1000 : key==='failureCount' ? 20 : key==='averageResponseTime' ? 60000 : clock());
          fresh.status=fresh.cooldownUntil>clock()?'cooldown':fresh.lastSuccess>fresh.lastFailure?'healthy':'unknown';
        }
        states[base][kind]=fresh;
      }
    }
    function record(entry) { diagnostics.push({...entry,at:clock()}); if (diagnostics.length>100) diagnostics.shift(); }
    function updateProviderHealth(base, kind, success, duration = 0, error) {
      if (!states[base] || !states[base][kind]) return;
      const state=states[base][kind];
      if (success) {
        state.status='healthy';state.lastSuccess=clock();state.failureCount=0;state.cooldownUntil=0;
        state.averageResponseTime=state.averageResponseTime ? state.averageResponseTime*.7+Math.max(0,duration)*.3 : Math.max(0,duration);
      } else {
        const code=classifyError(error).code;
        if (code==='CANCELLED' || code==='NOT_FOUND' || code==='INVALID_RESPONSE' || code==='VIDEO_UNAVAILABLE') return;
        state.lastFailure=clock();state.failureCount++;
        const severe=['UNAUTHORIZED','FORBIDDEN','RATE_LIMITED','NETWORK_OR_CORS','TIMEOUT'].includes(code);
        const wait=code==='RATE_LIMITED' ? 120000 : severe ? 30000 : state.failureCount>=2 ? 20000 : 0;
        state.cooldownUntil=wait ? clock()+Math.min(300000,wait*2**Math.min(3,state.failureCount-1)) : 0;
        state.status=wait?'cooldown':'degraded';
      }
      save(healthKey,states);
    }
    function getHealthyProviders(kind='api', resource='') {
      return bases.filter(base=>states[base][kind].cooldownUntil<=clock() && (resourceFailures.get(base+resource)||0)<=clock()).sort((a,b)=>{
        const score=base=>{const s=states[base][kind];return (s.lastSuccess>s.lastFailure?0:100000)+s.failureCount*10000+(s.averageResponseTime||5000);};
        return score(a)-score(b);
      });
    }
    function getCachedData(key,validate) {
      const entry=cache.get(key);
      if (!entry || entry.expires<=clock()) {cache.delete(key);return null;}
      try {if (validate && !validate(entry.data)) throw new Error();return entry.data;} catch (_) {cache.delete(key);return null;}
    }
    function setCachedData(key,data,ttl) {
      if (!Number.isFinite(ttl) || ttl<=0 || JSON.stringify(data).length>1000000) return;
      cache.delete(key);cache.set(key,{key,data,expires:clock()+Math.min(ttl,23*60*60*1000)});
      while (cache.size>maxEntries) cache.delete(cache.keys().next().value);
      save(dataKey,{entries:[...cache.values()]});
    }
    async function fetchFromProvider(base,path,{signal,validate=()=>true,timeoutMs=timeout}={}) {
      if (!bases.includes(base) || !path.startsWith('/api/v1/')) throw new AppError('INVALID_REQUEST');
      const started=clock();
      try {
        const data=await fetchJSON(fetcher,base+path,{timeout:timeoutMs,signal});
        if (!validate(data)) throw new AppError('INVALID_RESPONSE');
        if (data && typeof data === 'object') {networkData.add(data);dataProviders.set(data,base);}
        updateProviderHealth(base,'api',true,clock()-started);
        save('kidsYoutubeLastInstance',{scope,url:base});
        record({kind:'api',provider:base,path,outcome:'success',ms:clock()-started});
        return data;
      } catch (error) {
        const problem=classifyError(error);
        // A video/channel-specific 404 or invalid payload is not a global outage.
        if (problem.code !== 'CANCELLED') resourceFailures.set(base+path,clock()+30000);
        updateProviderHealth(base,'api',false,clock()-started,problem);
        record({kind:'api',provider:base,path,outcome:problem.code,status:problem.status,ms:clock()-started});
        throw problem;
      }
    }
    async function request(path,{signal,validate=()=>true,ttl=0,force=false,timeoutMs=timeout}={}) {
      if (signal && signal.aborted) throw new AppError('CANCELLED');
      const cached=!force && getCachedData(path,validate);
      if (cached) {record({kind:'cache',path,outcome:'hit'});return cached;}
      if (!signal && inflight.has(path)) {record({kind:'cache',path,outcome:'coalesced'});const data=await inflight.get(path);if (!validate(data)) throw new AppError('INVALID_RESPONSE');return data;}
      const work=(async()=>{
        const end=clock()+budget;
        let last=new AppError('NO_HEALTHY_PROVIDER');
        for (const base of getHealthyProviders('api',path)) {
          if (clock()>=end) break;
          try {
            const data=await fetchFromProvider(base,path,{signal,validate,timeoutMs:Math.max(1,Math.min(timeoutMs,end-clock()))});
            if (ttl) setCachedData(path,data,ttl);
            return data;
          } catch (error) {last=error;if (last.code==='CANCELLED') throw last;}
        }
        throw last;
      })();
      if (!signal) inflight.set(path,work);
      try {return await work;} finally {if (inflight.get(path)===work) inflight.delete(path);}
    }
    function clearCache() {cache.clear();resourceFailures.clear();save(dataKey,{entries:[]});}
    function markResourceFailure(base,resource) {if (bases.includes(base))resourceFailures.set(base+resource,clock()+30000);}
    function clearResourceFailures(resource) {for (const base of bases) resourceFailures.delete(base+resource);}
    function resetHealth(kind) {for (const base of bases) for (const k of kind?[kind]:['api','playback']) states[base][k].cooldownUntil=0;save(healthKey,states);}
    async function healthCheck() {
      // One cheap probe per interval, not an all-provider fan-out. A successful
      // stats probe never claims the video-stream capability is healthy.
      const candidates=bases.filter(base=>states[base].api.cooldownUntil<=clock()).sort((a,b)=>Math.max(states[a].api.lastSuccess,states[a].api.lastFailure)-Math.max(states[b].api.lastSuccess,states[b].api.lastFailure));
      if (!candidates.length) return;
      const base=candidates[0];
      try {await fetchFromProvider(base,'/api/v1/stats',{validate:data=>!!data && !!data.software});} catch (_) { /* Captured in diagnostics. */ }
    }
    return {getDataProvider:data=>data && typeof data==='object' ? dataProviders.get(data) : null,isNetworkData:data=>!!data && typeof data==='object' && networkData.has(data),request,fetchFromProvider,getHealthyProviders,getCachedData,setCachedData,updateProviderHealth,healthCheck,clearCache,resetHealth,markResourceFailure,clearResourceFailures,record,snapshot:()=>({health:JSON.parse(JSON.stringify(states)),requests:diagnostics.slice(),cacheEntries:cache.size,inflight:inflight.size})};
  }
  return {AppError,classifyError,httpError,fetchJSON,createManager};
});
