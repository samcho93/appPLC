/* appPLC 서비스 워커 — 오프라인에서도 열리도록 앱 파일을 저장해 둔다
 *  네트워크를 먼저 쓰고(항상 최신), 연결이 없으면 저장본을 준다 (network-first)
 */
const VERSION = 'appplc-v3';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/ladderview.js', './js/app.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png'
];
const ENGINE = ['core', 'modules', 'plant', 'ladder', 'sim', 'plantview', 'monitor', 'bridge', 'samples', 'examples', 'vendor'];
['melsec', 'xgk'].forEach((v) => ENGINE.forEach((f) => SHELL.push(`./js/${v}/${f}.js`)));

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 로컬 브리지(실제 PLC) 요청은 저장하지 않는다
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res && res.ok && (sameOrigin || res.type === 'cors')) cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      const cached = await cache.match(req, { ignoreSearch: sameOrigin });
      if (cached) return cached;
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
