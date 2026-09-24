// ─────────────────────────────────────────────
//  sw.js — Service Worker Sentinel
//  Estratégia simples: network-first.
//  Não tenta fazer cache na instalação para
//  evitar falhas com caminhos de subdiretório.
// ─────────────────────────────────────────────

const CACHE = 'sentinel-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Supabase e esm.sh — nunca intercepta
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('esm.sh')) return;

  // Estratégia network-first com fallback para cache
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Só faz cache de respostas OK de GET
        if (e.request.method === 'GET' && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request)
        .then(cached => cached || caches.match('/index.html'))
      )
  );
});
