'use strict';

// Bump this whenever app-shell files change, so `activate` purges the old
// cache. This app is under active development — a stale cache-first
// service worker would otherwise silently keep serving old JS/menu data
// to an already-installed PWA with no visible error.
const CACHE_NAME = 'countercall-v8';
const APP_SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'config.js',
  'manifest.json',
  'menu.json',
  'icon-192.png',
  'icon-512.png',
  'vendor/socket.io.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first: always try to get the latest file (this app changes
// often), falling back to the cache only when offline. Still gives
// offline resilience without the staleness of cache-first.
// Never intercepts the Socket.io WebSocket — that's a plain network
// connection to a different origin, not a fetch() the service worker sees.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request))
  );
});
