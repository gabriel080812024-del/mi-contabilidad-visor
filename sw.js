// Guarda la app en el teléfono para que funcione sin internet. No guarda ni envía datos de la contabilidad.
const VERSION = 'visor-v2';
const ARCHIVOS = ['./', 'index.html', 'visor.js', 'visor.css', 'manifest.webmanifest', 'icono-180.png', 'icono-192.png', 'icono-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, {ignoreSearch: true}).then(r => r || fetch(e.request).then(resp => {
    const copia = resp.clone();
    if (resp.ok && new URL(e.request.url).origin === location.origin) caches.open(VERSION).then(c => c.put(e.request, copia));
    return resp;
  }).catch(() => caches.match('index.html'))));
});
