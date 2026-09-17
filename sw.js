// 오프라인용. 앱 파일을 캐시에 넣어두고, 인터넷이 없어도 그대로 열리게 한다.
const CACHE = 'budget-app-v1';
const SHELL = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './js/main.js',
  './js/store.js',
  './js/model.js',
  './js/views.js',
  './js/charts.js',
  './js/importers.js',
  './vendor/chart.umd.min.js',
  './vendor/xlsx.full.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 앱 파일: 캐시 먼저 (오프라인에서도 즉시 열림), 그동안 뒤에서 새 버전을 받아둔다
  e.respondWith(
    caches.match(request).then((hit) => {
      const net = fetch(request)
        .then((res) => {
          if (res && res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
          return res;
        })
        .catch(() => hit);
      return hit || net;
    }),
  );
});
