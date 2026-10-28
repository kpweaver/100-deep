/**
 * Offline play for the installed web app (Add to Home Screen).  Registered
 * only by the browser build when it is the top-level page (main.ts), never
 * inside itch.io's frame or the native app shells.
 *
 *  - The page itself: network first, so a new release shows up on the next
 *    launch; the cached copy when offline.
 *  - assets/ and engine/<hash>/ are named after their contents and never
 *    change: cache first.
 *  - Everything else (tiles, fonts, icons): network first, cached for offline.
 *
 * Saves are not here: they live in IndexedDB, which this never touches.
 */
const CACHE = '100-deep-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const immutable = /\/(assets|engine\/[0-9a-f]{12})\//.test(url.pathname);
  e.respondWith(immutable ? cacheFirst(req) : networkFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    throw err;
  }
}
