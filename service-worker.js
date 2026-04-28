/* =========================================================
   USAM Cuestionarios — Service Worker
   Estrategia: Cache-First para assets estáticos,
                Network-First para datos JSONbin
   ========================================================= */

const CACHE_NAME = 'usam-cuestionarios-v3';
const STATIC_ASSETS = [
  '/cuestionarios-usam/',
  '/cuestionarios-usam/index.html',
  '/cuestionarios-usam/admin-mobile.html',
  '/cuestionarios-usam/manifest.json',
  '/cuestionarios-usam/icons/icon-192.png',
  '/cuestionarios-usam/icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600&display=swap'
];

// ── Install: pre-cachear assets estáticos ──────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS.map(url => {
        return new Request(url, { mode: 'no-cors' });
      })).catch(() => {
        // Si falla algún asset no crítico, continuar igual
        return Promise.resolve();
      });
    })
  );
  self.skipWaiting();
});

// ── Activate: limpiar caches viejos ───────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: estrategia por tipo de recurso ─────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // JSONbin.io → Network-First (datos en tiempo real)
  if (url.hostname === 'api.jsonbin.io') {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Google Fonts → Cache-First
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Assets del propio sitio → Stale-While-Revalidate
  if (url.hostname === 'oscargonzalezpleitez-dot.github.io') {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // Resto: red normal
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

// ── Estrategias de cache ───────────────────────────────────
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response(JSON.stringify({ error: 'offline' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('', { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || fetchPromise;
}

// ── Mensaje desde la app principal ────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  // Ping de "alumno activo" retransmitido a todos los clientes
  if (event.data && event.data.type === 'STUDENT_ACTIVE') {
    self.clients.matchAll().then(clients => {
      clients.forEach(client => client.postMessage(event.data));
    });
  }
});
