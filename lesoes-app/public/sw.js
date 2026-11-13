// Cache apenas do "esqueleto" do app; dados clínicos (API) nunca são guardados offline.
const CACHE = 'lesoes-v9';
const SHELL = ['/', '/app.js', '/style.css', '/logo.png', '/icon-192-v2.png', '/fonts/fraunces-latin-wght-normal.woff2', '/fonts/figtree-latin-wght-normal.woff2', '/manifest.webmanifest'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});

// Alertas push (ex.: tentativa de captura de tela, para o administrador)
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data.json(); } catch { /* sem conteúdo */ }
  e.waitUntil(self.registration.showNotification(d.titulo || 'EvoluIA', { body: d.texto || '', icon: '/icon-192-v2.png', badge: '/icon-192-v2.png', tag: d.tag || 'evoluia', data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => (cs.length ? cs[0].focus() : self.clients.openWindow(e.notification.data?.url || '/'))));
});
