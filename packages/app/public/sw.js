// Offline support. Game assets (assets/**, ~220 MB) are cache-first in a cache keyed by the asset tree's version
// (sw.js?a=<assets id>), so app rebuilds keep them; they are filled on demand, nothing is precached. The bundle
// (js/**, content-hashed names) is cache-first too, in a per-build cache. The page goes network-first into that
// cache so a new build is picked up when online; it is precached on install so a reload works offline after the
// first visit.
// An asset the cache lacks is fetched as <path>?a=<assets id>: the host serves those URLs immutable (vercel.json), so
// the CDN and the browser keep them without asking the origin again, and a new asset tree never reads the old one's.
const params = new URL(self.location.href).searchParams;
const APP = 'sts2-app-' + (params.get('v') ?? 'dev');
const ASSETS = 'sts2-assets-' + (params.get('a') ?? 'dev');
self.addEventListener('install', (e) => e.waitUntil((async () => {
  try { await (await caches.open(APP)).add('./'); } catch { /* offline install: filled on first fetch */ }
  await self.skipWaiting();
})()));
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== APP && k !== ASSETS) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const scope = new URL(self.registration.scope).pathname;
  const isAsset = url.pathname.startsWith(scope + 'assets/');
  e.respondWith((async () => {
    if (isAsset || url.pathname.startsWith(scope + 'js/')) {
      const cache = await caches.open(isAsset ? ASSETS : APP);
      const hit = await cache.match(req);
      if (hit) return hit;
      if (isAsset) {
        url.searchParams.set('a', params.get('a') ?? 'dev');
        // Cloudflare redirects a path with a literal @ (the …@0.5x images) to its %40 form: ask for that one
        url.pathname = url.pathname.replaceAll('@', '%40');
      }
      const res = await fetch(isAsset && req.mode !== 'navigate' ? new Request(url, req) : req);
      if (res.ok && res.status === 200) cache.put(req, res.clone());
      return res;
    }
    const cache = await caches.open(APP);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) ?? Response.error();
    }
  })());
});
