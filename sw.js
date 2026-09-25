// ─────────────────────────────────────────────
//  sw.js — Sentinel Service Worker
//
//  O que este SW faz para manter o GPS vivo:
//
//  1. Cache de assets estáticos (funcionalidade offline básica)
//  2. Background Sync: quando o app vai para background e perde
//     conexão, os pontos GPS salvos são reenviados ao Supabase
//     quando a conexão retorna.
//  3. Periodic Background Sync: em navegadores que suportam
//     (Chrome Android), solicita posição GPS mesmo com app
//     minimizado a cada ~1 minuto.
//  4. keepalive via fetch: mantém o SW ativo respondendo ao
//     ping enviado pelo client.js a cada 25s.
//
//  IMPORTANTE sobre limitações reais:
//  - iOS Safari: background fetch é suspenso pelo SO.
//    O Wake Lock da tela é a única solução viável no iOS.
//  - Android Chrome: watchPosition sobrevive com tela minimizada
//    SE o PWA estiver instalado (Add to Home Screen).
//    Sem instalação, o comportamento varia.
//  - A Periodic Background Sync API requer:
//    * PWA instalado
//    * Chrome 80+ no Android
//    * Permissão "Background Sync" concedida
// ─────────────────────────────────────────────

const CACHE_NAME = 'sentinel-v1';

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

// ── Fetch (cache-first para assets, network para API) ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Requisições ao Supabase sempre vão para a rede
  if (url.hostname.includes('supabase') || url.hostname.includes('nominatim')) {
    return; // deixa passar sem interceptar
  }

  // Ping de keepalive vindo do client.js
  if (url.pathname === '/sw-ping') {
    event.respondWith(new Response('ok', { status: 200 }));
    return;
  }

  // Assets estáticos: cache-first
  event.respondWith(
    caches.match(event.request).then(cached => cached ?? fetch(event.request))
  );
});

// ── Background Sync ───────────────────────────
// Quando a rede volta após ficar offline, reenvia pontos GPS
// que ficaram na fila (armazenados pelo client.js via IDB/localStorage).
// O tag 'gps-sync' é registrado pelo client.js via:
//   navigator.serviceWorker.ready.then(sw => sw.sync.register('gps-sync'))
self.addEventListener('sync', event => {
  if (event.tag === 'gps-sync') {
    event.waitUntil(flushPendingGPS());
  }
});

async function flushPendingGPS() {
  // Abre IDB e reenvia pontos pendentes
  // O client.js salva em IDB quando offline
  try {
    const db = await openIDB();
    const pending = await idbGetAll(db, 'pending_gps');
    if (!pending.length) return;

    // Importa config do client (device_id e URL do Supabase)
    // via mensagem para a aba ativa
    const clients = await self.clients.matchAll({ type: 'window' });
    if (!clients.length) return; // nenhuma aba aberta, não tem config

    // Pede para a aba ativa enviar os pontos pendentes
    clients[0].postMessage({ type: 'FLUSH_PENDING_GPS', points: pending });
  } catch (e) {
    console.warn('[SW] flushPendingGPS falhou:', e);
  }
}

// ── Periodic Background Sync ──────────────────
// Chrome Android (instalado como PWA) chama este evento
// mesmo com o app em background.
// Registrado pelo client.js:
//   const status = await navigator.permissions.query({ name: 'periodic-background-sync' })
//   if (status.state === 'granted') {
//     const sw = await navigator.serviceWorker.ready
//     await sw.periodicSync.register('gps-tick', { minInterval: 60_000 })
//   }
self.addEventListener('periodicsync', event => {
  if (event.tag === 'gps-tick') {
    event.waitUntil(requestGPSFromClient());
  }
});

async function requestGPSFromClient() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (clients.length) {
    // App está aberto — pede para o client.js forçar uma leitura GPS
    clients.forEach(c => c.postMessage({ type: 'REQUEST_GPS_UPDATE' }));
  }
  // Se não tiver cliente aberto: sem acesso ao GPS daqui.
  // O Periodic Background Sync apenas garante que o SW acorda,
  // mas geolocalização só funciona com uma janela aberta.
}

// ── Push (futuro) ──────────────────────────────
// Placeholder para notificações push futuras (ex: SOS, bateria baixa)
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Sentinel', {
      body: data.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag ?? 'sentinel-alert',
    })
  );
});

// ── Mensagens do client.js ────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
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
