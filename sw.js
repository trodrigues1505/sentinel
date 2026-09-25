// ─────────────────────────────────────────────
//  sw.js — Sentinel Service Worker
// ─────────────────────────────────────────────

// ── VERSÃO ────────────────────────────────────
// Quando atualizar o app, bumpe este valor.
// O index.html tem APP_VERSION com o mesmo valor.
// Se divergirem, o banner de atualização aparece.
const SW_VERSION = '1.0.0';
const CACHE_NAME = `sentinel-${SW_VERSION}`;

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/config.js',
  '/js/gps.js',
  '/js/camera.js',
  '/js/webrtc.js',
  '/js/ui.js',
  '/js/supabase-client.js',
  '/manifest.json',
];

// ── Install ───────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate ──────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (url.hostname.includes('supabase') || url.hostname.includes('nominatim')) return;

  if (url.pathname === '/sw-ping') {
    event.respondWith(new Response('ok', { status: 200 }));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached ?? fetch(event.request))
  );
});

// ── Background Sync ───────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'gps-sync') event.waitUntil(flushPendingGPS());
});

async function flushPendingGPS() {
  try {
    const db = await openIDB();
    const pending = await idbGetAll(db, 'pending_gps');
    if (!pending.length) return;
    const clients = await self.clients.matchAll({ type: 'window' });
    if (!clients.length) return;
    clients[0].postMessage({ type: 'FLUSH_PENDING_GPS', points: pending });
  } catch (e) {
    console.warn('[SW] flushPendingGPS falhou:', e);
  }
}

// ── Periodic Background Sync ──────────────────
self.addEventListener('periodicsync', event => {
  if (event.tag === 'gps-tick') event.waitUntil(requestGPSFromClient());
});

async function requestGPSFromClient() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach(c => c.postMessage({ type: 'REQUEST_GPS_UPDATE' }));
}

// ── Push ──────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Sentinel', {
      body:  data.body  ?? '',
      icon:  '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag:   data.tag   ?? 'sentinel-alert',
    })
  );
});

// ── Mensagens ─────────────────────────────────
self.addEventListener('message', event => {
  switch (event.data?.type) {

    // Índice pergunta a versão do SW para comparar com APP_VERSION
    case 'GET_VERSION':
      event.source.postMessage({ type: 'SW_VERSION', version: SW_VERSION });
      break;

    // Índice pediu para o SW se atualizar imediatamente
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
  }
});

// ── Helpers IDB ──────────────────────────────
function openIDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('sentinel-db', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pending_gps')) {
        db.createObjectStore('pending_gps', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

function idbGetAll(db, storeName) {
  return new Promise((res, rej) => {
    const tx  = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}
