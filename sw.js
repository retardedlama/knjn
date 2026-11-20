// Offline support: every file the app needs (including Stockfish and the
// opening database) is cached on first visit, so the installed app works
// without a connection. Files are served from the cache and refreshed in the
// background, so updates arrive on the next launch. Bump VERSION to force a
// full refresh.
const VERSION = 'opening-trainer-v4';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/classify.js',
  'js/book.js',
  'js/engine.js',
  'js/explain.js',
  'js/guides.js',
  'js/progress.js',
  'js/sound.js',
  'data/openings.json',
  'vendor/chessground/chessground.min.js',
  'vendor/chessground/chessground.base.css',
  'vendor/chessground/chessground.brown.css',
  'vendor/chessground/chessground.cburnett.css',
  'vendor/chessjs/chess.js',
  'vendor/stockfish/stockfish-19-lite-single.js',
  'vendor/stockfish/stockfish-19-lite-single.wasm',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(VERSION)
      // cache: 'reload' skips the browser's HTTP cache so an update really
      // downloads the new files.
      .then(cache => cache.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(VERSION).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then(res => {
          if (res.ok && res.type === 'basic') cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      const res = await network;
      if (res) return res;
      if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
      return Response.error();
    })
  );
});
