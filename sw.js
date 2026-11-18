/*
 * sw.js — the service worker that lets the app install and work offline.
 *
 * Network first: when you're online, every request goes to GitHub Pages, so
 * each merged change shows up. A copy of each file is saved in the cache, and
 * that copy is used only when the network can't be reached.
 *
 * All paths are relative to this file, because the site lives at
 * https://<username>.github.io/<repository>/, not at the root of a domain.
 */
const CACHE = 'age-capstruct-v1';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'capstruct.js',
  'manifest.webmanifest',
  'data/cdss.csv',
  'data/assumptions.csv',
  'data/banker_schedule.csv',
  'data/example_firms.csv',
  'data/ebit_scenarios.csv',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

// Save every file the app needs when the service worker is installed.
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
  self.skipWaiting();
});

// Remove caches left by older versions of this file.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // Only handle this site's own GET requests.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then(hit =>
          hit || (req.mode === 'navigate' ? caches.match('./') : Response.error())
        )
      )
  );
});
