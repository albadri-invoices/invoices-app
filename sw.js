// خدمة العمل بدون إنترنت: تحفظ واجهة التطبيق في الجهاز. البيانات لا تُحفظ هنا (تُحفظ في IndexedDB)، وطلبات الخادم لا تمر من الكاش.
const CACHE = 'daftar-v3.0.0';
const SHELL = ['./', 'index.html', 'app.css?v=3.0.0', 'app.js?v=3.0.0', 'config.js?v=3.0.0', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('script.google.com') || url.hostname.endsWith('googleusercontent.com')) return;
  // الصفحة والملفات: الشبكة أولًا (علشان التحديثات توصل)، والكاش عند انقطاع الإنترنت
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok && (url.origin === location.origin || url.hostname.includes('cdnjs') || url.hostname.includes('fonts.g'))) {
        const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
