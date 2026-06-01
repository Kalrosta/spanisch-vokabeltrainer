/**
 * Service Worker - Cache & Offline-Strategie
 *
 * Strategie:
 * - App-Shell (index.html, css, js): cache-first mit Update im Hintergrund
 * - Daten (data/*.json): network-first, fallback auf cache
 *
 * Cache wird mit jeder neuen SW-Version invalidiert. Bei Änderungen
 * an Code oder Daten: VERSION hochzählen.
 */
const VERSION = "v1.0.0";
const CACHE = `esp-b2-${VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./fsrs.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Nur same-origin behandeln
  if (url.origin !== location.origin) return;

  // Data: network-first
  if (url.pathname.includes("/data/")) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Rest: cache-first
  event.respondWith(cacheFirst(request));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) {
    fetch(req).then(res => {
      if (res.ok) cache.put(req, res);
    }).catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return new Response("Offline", { status: 503 });
  }
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response("Offline", { status: 503 });
  }
}
