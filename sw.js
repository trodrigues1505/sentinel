// ─────────────────────────────────────────────
//  sw.js — Service Worker Sentinel
//  Estratégia: cache-first para assets estáticos,
//  network-first para dados do Supabase.
// ─────────────────────────────────────────────

const CACHE_NAME = 'sentinel-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/app.css',
  '/js/config.js',
  '/js/supabase-client.js',
  '/js/auth.js',
  '/js/gps.js',
  '/js/camera.js',
  '/js/webrtc.js',
  '/js/ui.js',
  '/admin/index.html',
];

// ── Install ───────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate — limpa caches antigos ──────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch — cache-first para assets, pass-through para Supabase ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Supabase e esm.sh — sempre busca da rede
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('esm.sh')) {
    return; // deixa o browser tratar normalmente
  }

  // Assets estáticos — cache first
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request)
        .catch(() => caches.match('/index.html'))
      )
  );
});
