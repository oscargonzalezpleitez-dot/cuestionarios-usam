// USAM Cuestionarios — Service Worker
// Habilita modo offline, cache de recursos, notificaciones nativas y polling en background.

const CACHE_NAME = 'usam-cache-v3';
const CORE_ASSETS = [
    './',
    './index.html',
    './admin.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
  ];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
          caches.open(CACHE_NAME).then((cache) =>
                  Promise.all(
                            CORE_ASSETS.map((url) =>
                                        cache.add(url).catch((e) => console.warn('SW cache miss:', url, e))
                                                    )
                          )
                                           )
        );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
          caches.keys().then((keys) =>
                  Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
                                 ).then(() => self.clients.claim())
        );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

                        // Nunca cachear llamadas a JSONBin (deben ser siempre frescas)
                        if (url.hostname.includes('jsonbin.io')) {
                              event.respondWith(fetch(req).catch(() => new Response(JSON.stringify({record: []}), {headers: {'Content-Type':'application/json'}})));
                              return;
                        }

                        // Estrategia: stale-while-revalidate para todo lo demás
                        event.respondWith(
                              caches.match(req).then((cached) => {
                                      const network = fetch(req).then((res) => {
                                                if (res && res.status === 200) {
                                                            const copy = res.clone();
                                                            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
                                                }
                                                return res;
                                      }).catch(() => cached);
                                      return cached || network;
                              })
                            );
});

// ===== Notificaciones (locales, disparadas vía postMessage desde la página) =====
self.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'SHOW_NOTIFICATION') {
          const { title, body, tag, badge, icon, data: payload } = data;
          self.registration.showNotification(title || 'USAM Cuestionarios', {
                  body: body || '',
                  icon: icon || './icon-192.png',
                  badge: badge || './icon-192.png',
                  tag: tag || 'usam-notif',
                  vibrate: [200, 100, 200, 100, 200],
                  requireInteraction: true,
                  data: payload || {},
                  actions: [
                    { action: 'open', title: 'Ver respuesta' },
                    { action: 'dismiss', title: 'Descartar' }
                          ]
          });
    } else if (data.type === 'SET_BADGE') {
          if ('setAppBadge' in self.navigator) {
                  self.navigator.setAppBadge(data.count || 0).catch(() => {});
          }
    } else if (data.type === 'CLEAR_BADGE') {
          if ('clearAppBadge' in self.navigator) {
                  self.navigator.clearAppBadge().catch(() => {});
          }
    } else if (data.type === 'SKIP_WAITING') {
          self.skipWaiting();
    }
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    if (event.action === 'dismiss') return;
    const targetUrl = (event.notification.data && event.notification.data.url) || './admin.html#results';
    event.waitUntil(
          self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
                  for (const w of wins) {
                            if (w.url.includes('cuestionarios-usam') && 'focus' in w) {
                                        w.postMessage({ type: 'OPEN_RESULTS', binId: event.notification.data?.binId });
                                        return w.focus();
                            }
                  }
                  if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
          })
        );
});

// ===== Background sync (polling cada vez que el SO lo permita) =====
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'usam-poll-results') {
          event.waitUntil(pollForNewResults());
    }
});

async function pollForNewResults() {
    try {
          const REGISTRY_BIN = '69d949f636566621a89cf818';
          const JKEY = '$2a$10$C2DJcKFtIYQMvrmMJ64oYuMnkdH6I9PRx3z3p..uVb5fzo9Be7xTK';
          const r = await fetch(`https://api.jsonbin.io/v3/b/${REGISTRY_BIN}/latest`, {
                  headers: { 'X-Master-Key': JKEY }
          });
          if (!r.ok) return;
          const d = await r.json();
          const list = Array.isArray(d.record) ? d.record : [];
          const cache = await caches.open('usam-state');
          const prevResp = await cache.match('last-known-list');
          const prev = prevResp ? await prevResp.json() : [];
          const nuevos = list.filter((id) => !prev.includes(id));
          if (nuevos.length > 0) {
                  self.registration.showNotification('📝 Nueva respuesta recibida', {
                            body: `${nuevos.length} alumno(s) acaba(n) de enviar su cuestionario.`,
                            icon: './icon-192.png',
                            badge: './icon-192.png',
                            tag: 'usam-new-result',
                            vibrate: [200, 100, 200],
                            requireInteraction: true,
                            data: { url: './admin.html#results', count: nuevos.length }
                  });
                  if ('setAppBadge' in self.navigator) {
                            self.navigator.setAppBadge(nuevos.length).catch(() => {});
                  }
          }
          await cache.put('last-known-list', new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } }));
    } catch (e) {
          console.warn('SW poll error', e);
    }
}
