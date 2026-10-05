'use strict';

// Scoped cache names avoid deleting another PWA's caches on the same GitHub origin.
const CACHE_PREFIX = 'kids-youtube-shell:' + self.registration.scope + ':';
const SHELL_CACHE = CACHE_PREFIX + 'v3';
const SHELL_FILES = ['./index.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];
const SCOPE_URL = new URL(self.registration.scope);
const SHELL_URLS = new Set(SHELL_FILES.map(path => new URL(path, SCOPE_URL).href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // A failed cache write must not prevent activation/browsing.
    try {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL_FILES.map(path => new Request(new URL(path, SCOPE_URL), {cache:'reload'})));
    } catch (_) { /* Storage may be full or blocked. */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE).map(key => caches.delete(key)));
    } finally { await self.clients.claim(); }
  })());
});

async function networkFirst(request, cacheKey) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      try { const cache = await caches.open(SHELL_CACHE); await cache.put(cacheKey, response.clone()); } catch (_) { /* Browsing can continue without cache. */ }
    }
    return response;
  } catch (error) {
    const cached = await caches.match(cacheKey, {cacheName:SHELL_CACHE});
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== SCOPE_URL.origin) return;
  // Never cache/intercept the whitelist, API calls, streams, or embeds.
  // index.html handles last-known whitelist data in localStorage explicitly.
  if (url.pathname === new URL('./videos.txt', SCOPE_URL).pathname) return;
  if (request.mode === 'navigate' && (url.pathname === SCOPE_URL.pathname || url.pathname === new URL('./index.html', SCOPE_URL).pathname)) {
    event.respondWith(networkFirst(request, new URL('./index.html', SCOPE_URL).href));
  } else if (SHELL_URLS.has(url.href)) {
    event.respondWith(networkFirst(request, url.href));
  }
});
