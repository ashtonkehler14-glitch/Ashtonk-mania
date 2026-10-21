/* Ashtonk!mania service worker — once the game has been opened, it opens and plays offline.
 *  - The page: network first, so a new deploy shows up on the next load; the saved copy when offline.
 *  - Bundled files (Neru pictures, avatars, icons, the Kori skin): served from the cache and refreshed in the
 *    background (requests that ask for a fresh copy, like the Kori upgrade check, go to the network first).
 *  - Google Fonts: cached, so the text looks right offline.
 *  - /api/* (search, downloads, multiplayer) and other sites (mirrors, covers, previews) are never cached here.
 *  Beatmaps, skins, scores and settings live in IndexedDB, not in these caches. */
const VERSION = 'e84622ad1956'; // (changes with every build, so browsers pick up a new service worker after a deploy)
const PAGES = 'ashtonk-pages', ASSETS = 'ashtonk-assets', FONTS = 'ashtonk-fonts', SHARED = 'ashtonk-shared';
const CORE = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'neru.png', 'neru-happy.png', 'avatars/avatars.json'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    try {
      const pages = await caches.open(PAGES), assets = await caches.open(ASSETS);
      // (only a page that came: a server error saved here would be what opens offline)
      const res = await fetch('./', { cache: 'reload' });
      if (res.ok) await pages.put('./', res);
      await Promise.all(CORE.slice(1).map(u => fetch(u, { cache: 'reload' }).then(r => r.ok && assets.put(u, r)).catch(() => {})));
    } catch (err) { /* offline while installing: the next visit fills the caches */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('ashtonk-') && ![PAGES, ASSETS, FONTS, SHARED].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  // Android's share sheet ("Share → Ashtonk!mania", the manifest's share_target): the files wait in a cache of their
  // own, and the game opens to import them (App.takeShared)
  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/share-target')) { e.respondWith(shared(req)); return; }
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) return; // live data
    if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('/index.html')) { e.respondWith(page(req, e)); return; }
    e.respondWith(req.cache === 'no-cache' || req.cache === 'reload' || req.cache === 'no-store' ? networkFirst(req, ASSETS) : cacheFirst(req, ASSETS, e));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') e.respondWith(cacheFirst(req, FONTS, e));
});

// (the page asks which build this is: a worker taking over with the page's own build isn't an update to offer)
self.addEventListener('message', e => {
  if (e.data && e.data.t === 'version' && e.ports && e.ports[0]) e.ports[0].postMessage(VERSION);
});

async function shared(req) {
  try {
    const fd = await req.formData(), cache = await caches.open(SHARED);
    let i = 0;
    for (const f of fd.getAll('files')) {
      if (f && typeof f === 'object' && f.name) await cache.put(`./shared/${Date.now()}-${i++}/${encodeURIComponent(f.name)}`, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }));
    }
  } catch (err) { /* nothing usable came */ }
  return Response.redirect('./?shared=1', 303);
}

/** The game page: the network's copy (saved for offline), else the saved one — whatever the query string. On a
 *  connection that's there but barely (a weak signal), the saved copy opens after a few seconds instead of the game
 *  waiting on the network for as long as it takes; the network's copy is still saved when it arrives, for next time. */
const PAGE_WAIT = 4000;
async function page(req, e) {
  const cache = await caches.open(PAGES), saved = await cache.match('./');
  const net = fetch(req).then(async res => { if (res.ok && res.type === 'basic') await cache.put('./', res.clone()); return res; });
  if (e) e.waitUntil(net.catch(() => {}));
  let timer;
  const slow = saved ? new Promise(res => { timer = setTimeout(() => res(null), PAGE_WAIT); }) : null;
  try {
    const res = await (slow ? Promise.race([net, slow]) : net);
    if (res && (res.ok || !saved)) return res; // (the server failing: the saved copy, as when offline)
  } catch (err) { /* offline */ } finally { clearTimeout(timer); }
  return saved || new Response('<!doctype html><meta charset="utf-8"><title>Ashtonk!mania</title><body style="background:#18171c;color:#fff;font-family:sans-serif;padding:40px">You\'re offline, and the game hasn\'t been saved for offline play yet. Open it once while online.', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function networkFirst(req, name) {
  const cache = await caches.open(name);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

/** Serve from the cache at once and refresh it in the background; fetch (and save) when not cached yet. */
async function cacheFirst(req, name, e) {
  const cache = await caches.open(name);
  let hit = await cache.match(req);
  // (the page's <link> saves Google's stylesheet unreadable — opaque — and "Save as an HTML file" reads it: from the network)
  if (hit && hit.type === 'opaque' && req.mode === 'cors') hit = null;
  const refresh = fetch(req).then(res => { if (res.ok || res.type === 'opaque') return cache.put(req, res.clone()).then(() => res); return res; });
  if (hit) { e.waitUntil(refresh.catch(() => {})); return hit; }
  return refresh;
}
