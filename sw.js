// 오프라인 대응.
// 앱 코드(HTML·CSS·JS)는 "새 것 먼저, 안 되면 캐시" — 업데이트가 바로 반영된다.
// 라이브러리·아이콘은 "캐시 먼저" — 잘 바뀌지 않고 용량이 크다.
const CACHE = 'budget-app-v4';
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
  './js/gdrive.js',
  './js/config.js',
  './vendor/chart.umd.min.js',
  './vendor/xlsx.full.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const isAppCode = (url) => /\.(html|css|js|webmanifest)$/.test(url.pathname)
  || url.pathname.endsWith('/')
  || !url.pathname.includes('.');

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/vendor/') || url.pathname.includes('/icons/')) {
    // 캐시 먼저
    e.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); }
      return res;
    })));
    return;
  }
  if (!isAppCode(url)) return;   // 데이터 파일 등은 손대지 않는다
  // 새 것 먼저, 인터넷이 없으면 캐시
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); }
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html'))),
  );
});
