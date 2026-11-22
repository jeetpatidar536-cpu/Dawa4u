self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(self.registration.unregister().then(function () { return caches.keys(); }).then(function (k) { return Promise.all(k.map(function (c) { return caches.delete(c); })); }));
});
