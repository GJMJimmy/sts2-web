// Offline support. Game assets (assets/**, ~220 MB) are cache-first in a cache keyed by the asset tree's version
// (sw.js?a=<assets id>), so app rebuilds keep them; they are filled on demand, or in bulk by the offline button
// (the message handler below). The bundle
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
// Offline precache (ui/precache.tsx): the page posts {type:'precache', files:[[path, size], …]} (paths under assets/,
// as in the build's filelist.json) and the worker caches every file the ASSETS cache still lacks — the same keys the
// fetch handler matches, so a later page request hits. Already-cached files are skipped: interrupting and pressing the
// button again resumes where it stopped. Progress goes back to the sender every batch, in small batches so a burst of
// ~2000 downloads stays polite to the network and the cache's quota accounting.
self.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg?.type !== 'precache' || !Array.isArray(msg.files)) return;
  const client = e.source;
  e.waitUntil((async () => {
    const cache = await caches.open(ASSETS);
    const base = new URL(self.registration.scope).pathname + 'assets/';
    const list = msg.files.map((f) => (Array.isArray(f) ? f[0] : String(f)));
    const missing = [];
    for (const p of list) if (!(await cache.match(base + p))) missing.push(p);
    let done = 0, failed = 0;
    const send = (phase) => client.postMessage({ type: 'precache', phase, done, total: list.length, failed });
    send(missing.length ? 'fetch' : 'done');
    const BATCH = 8;
    for (let i = 0; i < missing.length; i += BATCH) {
      await Promise.all(missing.slice(i, i + BATCH).map(async (p) => {
        try {
          const url = new URL(base + p, self.location.origin);
          url.searchParams.set('a', params.get('a') ?? 'dev');
          url.pathname = url.pathname.replaceAll('@', '%40');
          const res = await fetch(url);
          if (res.ok && res.status === 200) await cache.put(base + p, res);
          else failed++;
        } catch { failed++; }
        done++;
        if (done % 25 === 0 || done === missing.length) send('fetch');
      }));
    }
    send('done');
  })());
});
