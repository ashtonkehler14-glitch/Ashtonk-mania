/* Ashtonk!mania service worker — once the game has been opened, it opens and plays offline.
 *  - The page: network first, so a new deploy shows up on the next load; the saved copy when offline.
 *  - Bundled files (Neru pictures, avatars, icons, the Kori skin): served from the cache and refreshed in the
 *    background (requests that ask for a fresh copy, like the Kori upgrade check, go to the network first).
 *  - Google Fonts: cached, so the text looks right offline.
 *  - /api/* (search, downloads, multiplayer) and other sites (mirrors, covers, previews) are never cached here.
 *  Beatmaps, skins, scores and settings live in IndexedDB, not in these caches. */
const VERSION = '8beadf3a9bc8';
const PAGES = 'ashtonk-pages', ASSETS = 'ashtonk-assets', FONTS = 'ashtonk-fonts';
const CORE = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'neru.png', 'neru-happy.png', 'avatars/avatars.json'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    try {
      const pages = await caches.open(PAGES), assets = await caches.open(ASSETS);
      await pages.put('./', await fetch('./', { cache: 'reload' }));
      await Promise.all(CORE.slice(1).map(u => fetch(u, { cache: 'reload' }).then(r => r.ok && assets.put(u, r)).catch(() => {})));
    } catch (err) { /* offline while installing: the next visit fills the caches */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('ashtonk-') && ![PAGES, ASSETS, FONTS].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) return; // live data
    if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('/index.html')) { e.respondWith(page(req)); return; }
    e.respondWith(req.cache === 'no-cache' || req.cache === 'reload' || req.cache === 'no-store' ? networkFirst(req, ASSETS) : cacheFirst(req, ASSETS, e));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') e.respondWith(cacheFirst(req, FONTS, e));
});

/** The game page: the network's copy (saved for offline), else the saved one — whatever the query string. */
async function page(req) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') await cache.put('./', res.clone());
    return res;
  } catch (err) {
    return (await cache.match('./')) || new Response('<!doctype html><meta charset="utf-8"><title>Ashtonk!mania</title><body style="background:#18171c;color:#fff;font-family:sans-serif;padding:40px">You\'re offline, and the game hasn\'t been saved for offline play yet. Open it once while online.', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
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
  const hit = await cache.match(req);
  const refresh = fetch(req).then(res => { if (res.ok || res.type === 'opaque') return cache.put(req, res.clone()).then(() => res); return res; });
  if (hit) { e.waitUntil(refresh.catch(() => {})); return hit; }
  return refresh;
}

void VERSION; // (changes with every build, so browsers pick up a new service worker after a deploy)
