'use strict';
const CACHE_PREFIX = 'kids-youtube-shell:' + self.registration.scope + ':';
const SHELL_CACHE = CACHE_PREFIX + 'v15';
const IMAGE_CACHE = 'kids-youtube-images:' + self.registration.scope + ':v1';
const SHELL_FILES = ['./index.html','./app.js?v=20261006j','./providers.js?v=20261006h','./manifest.json','./icons/icon-192.png','./icons/icon-512.png'];
const SCOPE_URL = new URL(self.registration.scope);
const SHELL_URLS = new Set(SHELL_FILES.map(path => new URL(path,SCOPE_URL).href));
const IMAGE_TTL = 7*24*60*60*1000;
const pendingImages = new Map();
self.addEventListener('install',event => {
  event.waitUntil((async () => {
    try {const cache=await caches.open(SHELL_CACHE);await cache.addAll(SHELL_FILES.map(path=>new Request(new URL(path,SCOPE_URL),{cache:'reload'})));} catch (_) {}
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event => {
  event.waitUntil((async () => {
    try {const keys=await caches.keys();await Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==SHELL_CACHE).map(key=>caches.delete(key)));} catch (_) {}
    await self.clients.claim();
  })());
});
async function networkFirst(request,cacheKey) {
  try {
    const response=await fetch(request,{cache:'no-store'});
    if (!response.ok) throw new Error('SHELL_UNAVAILABLE');
    if (response.type==='basic') {try {const cache=await caches.open(SHELL_CACHE);await cache.put(cacheKey,response.clone());} catch (_) {}}
    return response;
  } catch(error) {const cached=await caches.match(cacheKey,{cacheName:SHELL_CACHE});if(cached)return cached;throw error;}
}
async function thumbnail(request) {
  const url=request.url;
  if(pendingImages.has(url))return (await pendingImages.get(url)).clone();
  const task=(async()=>{
    let cache, stampURL;
    try {
      cache=await caches.open(IMAGE_CACHE);
      stampURL=new URL('./__image_time__/'+encodeURIComponent(url),SCOPE_URL).href;
      const [cached,stamp]=await Promise.all([cache.match(url),cache.match(stampURL)]);
      const age=stamp ? Date.now()-Number(await stamp.text()) : Infinity;
      if(cached && age>=0 && age<IMAGE_TTL)return cached;
    } catch (_) { /* Network still works without writable cache. */ }
    const response=await fetch(request);
    if(cache && (response.ok||response.type==='opaque')) {
      try {
        await cache.put(url,response.clone());await cache.put(stampURL,new Response(String(Date.now())));
        const keys=await cache.keys();
        if(keys.length>400)await Promise.all(keys.slice(0,keys.length-400).map(key=>cache.delete(key)));
      } catch (_) { /* Quota must not repeat an already successful fetch. */ }
    }
    return response;
  })();
  pendingImages.set(url,task);
  try{return (await task).clone();}finally{pendingImages.delete(url);}
}
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET')return;
  if(request.destination==='image'&&url.origin==='https://img.youtube.com'&&/^\/vi\/[A-Za-z0-9_-]{11}\/hqdefault\.jpg$/.test(url.pathname)&&!url.search){event.respondWith(thumbnail(request));return;}
  if(url.origin!==SCOPE_URL.origin)return;
  if(url.pathname===new URL('./videos.txt',SCOPE_URL).pathname)return;
  if(request.mode==='navigate'&&(url.pathname===SCOPE_URL.pathname||url.pathname===new URL('./index.html',SCOPE_URL).pathname))event.respondWith(networkFirst(request,new URL('./index.html',SCOPE_URL).href));
  else if(SHELL_URLS.has(url.href))event.respondWith(networkFirst(request,url.href));
});
