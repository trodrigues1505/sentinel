// ─────────────────────────────────────────────
//  gps.js — GPSTracker
//  Responsabilidades:
//    - watchPosition com alta precisão
//    - throttle de envio ao Supabase
//    - histórico local em memória (máx 500 pts)
//    - exportação CSV
//    - callbacks para atualização de UI
//
//  ITEM 2 — Suporte a background / tela apagada:
//    - Wake Lock API: mantém a tela ligada enquanto o app
//      estiver em modo "monitoramento ativo". Isso evita
//      que o SO suspenda o watchPosition no iOS Safari e
//      no Chrome que não tem permissão de background.
//    - IndexedDB offline queue: quando não há rede, pontos
//      são salvos no IDB. O Service Worker os reenvia via
//      Background Sync quando a rede retorna.
//    - SW keepalive: pinga o SW a cada 25s para mantê-lo
//      acordado (evita que o browser descarte o SW após
//      inatividade de 30s, que mataria o Periodic Sync).
//    - Periodic Background Sync: registrado aqui se disponível;
//      o SW responde com REQUEST_GPS_UPDATE.
//
//  Limitações que NENHUM código web resolve completamente:
//    - iOS Safari: ao bloquear a tela, o watchPosition para.
//      O Wake Lock só funciona enquanto o usuário está com
//      a tela ativa. Recomende ao usuário deixar o PWA
//      instalado e não bloquear a tela durante monitoramento.
//    - Android Chrome com PWA instalado: watchPosition
//      sobrevive com o app minimizado (não com tela bloqueada).
// ─────────────────────────────────────────────

import { supabase } from './supabase-client.js';
import { CONFIG }   from './config.js';

// ── IndexedDB helper (fila offline) ──────────
class OfflineQueue {
  #db = null;

  async open() {
    if (this.#db) return this.#db;
    return new Promise((res, rej) => {
      const req = indexedDB.open('sentinel-db', 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('pending_gps')) {
          db.createObjectStore('pending_gps', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = e => { this.#db = e.target.result; res(this.#db); };
      req.onerror   = e => rej(e.target.error);
    });
  }

  async enqueue(point) {
    const db  = await this.open();
    const tx  = db.transaction('pending_gps', 'readwrite');
    tx.objectStore('pending_gps').add(point);
    return new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror    = e => rej(e.target.error);
    });
  }

  async getAll() {
    const db  = await this.open();
    const tx  = db.transaction('pending_gps', 'readonly');
    const req = tx.objectStore('pending_gps').getAll();
    return new Promise((res, rej) => {
      req.onsuccess = e => res(e.target.result);
      req.onerror   = e => rej(e.target.error);
    });
  }

  async clear() {
    const db  = await this.open();
    const tx  = db.transaction('pending_gps', 'readwrite');
    tx.objectStore('pending_gps').clear();
    return new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror    = e => rej(e.target.error);
    });
  }
}

// ── GPSTracker ────────────────────────────────
export class GPSTracker {
  #watchId       = null;
  #lastSentAt    = 0;
  #points        = [];
  #onUpdate      = null;
  #onError       = null;
  #wakeLock      = null;     // ITEM 2: Wake Lock handle
  #swKeepalive   = null;     // ITEM 2: setInterval do ping ao SW
  #offlineQueue  = new OfflineQueue();

  get isTracking() { return this.#watchId !== null; }
  get points()     { return this.#points; }
  get lastPoint()  { return this.#points.at(-1) ?? null; }

  /** @param {{ onUpdate, onError }} callbacks */
  constructor({ onUpdate, onError } = {}) {
    this.#onUpdate = onUpdate ?? (() => {});
    this.#onError  = onError  ?? (() => {});

    // Restaura histórico salvo localmente
    try {
      const saved = localStorage.getItem('sentinel_gps');
      if (saved) this.#points = JSON.parse(saved);
    } catch { /* ignora */ }

    // ITEM 2: escuta mensagens do SW (REQUEST_GPS_UPDATE e FLUSH_PENDING_GPS)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data?.type === 'REQUEST_GPS_UPDATE') {
          this.#forceUpdate();
        }
        if (event.data?.type === 'FLUSH_PENDING_GPS') {
          this.#flushOfflineQueue();
        }
      });
    }
  }

  // ── Start / Stop ────────────────────────────
  start() {
    if (this.isTracking) return;
    if (!navigator.geolocation) {
      this.#onError('GPS não disponível neste dispositivo.');
      return;
    }

    this.#watchId = navigator.geolocation.watchPosition(
      pos  => this.#handlePosition(pos),
      err  => this.#onError(`Erro GPS: ${err.message}`),
      CONFIG.gps.options
    );

    // ITEM 2: ativa Wake Lock e keepalive do SW
    this.#acquireWakeLock();
    this.#startSWKeepalive();
    this.#registerPeriodicSync();
  }

  stop() {
    if (!this.isTracking) return;
    navigator.geolocation.clearWatch(this.#watchId);
    this.#watchId = null;

    // ITEM 2: libera Wake Lock e keepalive
    this.#releaseWakeLock();
    this.#stopSWKeepalive();
  }

  // ── ITEM 2: Wake Lock ─────────────────────
  // Mantém a tela ligada enquanto monitorando.
  // Funciona em: Chrome 84+, Edge 84+, Opera 71+, Safari 16.4+
  // Não funciona em: Firefox (implementação pendente)
  // Quando o usuário minimiza o app (não bloqueia a tela),
  // o Wake Lock é liberado automaticamente pelo browser.
  // Reativamos ao `visibilitychange` (quando volta para o app).
  async #acquireWakeLock() {
    if (!('wakeLock' in navigator)) return; // não suportado
    try {
      this.#wakeLock = await navigator.wakeLock.request('screen');

      // Se o browser liberou o wake lock automaticamente (ex: minimizou),
      // tenta readquirir quando o usuário volta para o app.
      this.#wakeLock.addEventListener('release', () => {
        this.#wakeLock = null;
        // Não tenta readquirir aqui — o visibilitychange cuida disso
      });

      document.addEventListener('visibilitychange', this.#handleVisibilityChange);
    } catch (e) {
      // Pode falhar se bateria baixa ou permissão negada — não crítico
      console.warn('[GPS] Wake Lock não obtido:', e.message);
    }
  }

  #handleVisibilityChange = async () => {
    if (document.visibilityState === 'visible' && this.isTracking && !this.#wakeLock) {
      await this.#acquireWakeLock();
    }
  };

  #releaseWakeLock() {
    this.#wakeLock?.release();
    this.#wakeLock = null;
    document.removeEventListener('visibilitychange', this.#handleVisibilityChange);
  }

  // ── ITEM 2: SW Keepalive ──────────────────
  // O Service Worker é encerrado pelo browser após ~30s de inatividade.
  // Sem SW ativo, o Periodic Background Sync não funciona.
  // Pingamos a cada 25s para manter o SW acordado.
  #startSWKeepalive() {
    if (!('serviceWorker' in navigator)) return;
    this.#swKeepalive = setInterval(async () => {
      try {
        await fetch('/sw-ping', { method: 'GET', cache: 'no-store' });
      } catch { /* offline — ignora */ }
    }, 25_000);
  }

  #stopSWKeepalive() {
    clearInterval(this.#swKeepalive);
    this.#swKeepalive = null;
  }

  // ── ITEM 2: Periodic Background Sync ─────
  // Registra sincronização periódica para ser chamada pelo SO
  // mesmo com o app minimizado (Chrome Android, PWA instalado).
  async #registerPeriodicSync() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const sw     = await navigator.serviceWorker.ready;
      const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (status.state === 'granted' && 'periodicSync' in sw) {
        await sw.periodicSync.register('gps-tick', { minInterval: 60_000 }); // mínimo 1 min
      }
    } catch {
      // Não suportado ou permissão negada — graceful degradation
    }
  }

  // ── ITEM 2: Forçar leitura GPS única ─────
  // Chamado pelo SW via message quando o Periodic Sync acorda.
  #forceUpdate() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => this.#handlePosition(pos),
      () => {}, // silencioso — pode falhar em background
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  }

  // ── Position handler ──────────────────────
  async #handlePosition(pos) {
    const { latitude: lat, longitude: lon, accuracy: acc } = pos.coords;
    const point = { lat, lon, acc, t: Date.now() };

    // Acumula em memória
    this.#points.push(point);
    if (this.#points.length > 500) this.#points.shift();

    // Persiste localmente (últimos 200 pontos)
    try {
      localStorage.setItem('sentinel_gps', JSON.stringify(this.#points.slice(-200)));
    } catch { /* quota excedida — ignora */ }

    // Notifica UI
    this.#onUpdate(point);

    // Throttle: só envia ao Supabase a cada minInterval
    const now = Date.now();
    if (now - this.#lastSentAt < CONFIG.gps.minInterval) return;
    this.#lastSentAt = now;

    await this.#sendToSupabase(point);
  }

  async #sendToSupabase(point) {
    const payload = {
      device_id: CONFIG.deviceId,
      lat:       point.lat,
      lon:       point.lon,
      accuracy:  point.acc,
    };

    const { error } = await supabase.from('gps_points').insert(payload);

    if (error) {
      console.warn('[GPS] Erro ao enviar:', error.message);

      // ITEM 2: offline? Salva na fila do IDB para reenviar depois
      if (!navigator.onLine) {
        try {
          await this.#offlineQueue.enqueue({ ...payload, queued_at: Date.now() });
          // Registra Background Sync para reenviar quando a rede voltar
          const sw = await navigator.serviceWorker?.ready;
          if (sw?.sync) await sw.sync.register('gps-sync');
        } catch (e) {
          console.warn('[GPS] Não foi possível salvar na fila offline:', e);
        }
      }
    }
  }

  // ── ITEM 2: Flush fila offline ───────────
  // Chamado pelo SW via message quando a rede volta (Background Sync).
  async #flushOfflineQueue() {
    const pending = await this.#offlineQueue.getAll();
    if (!pending.length) return;

    const { error } = await supabase.from('gps_points').insert(
      pending.map(p => ({
        device_id: p.device_id,
        lat:       p.lat,
        lon:       p.lon,
        accuracy:  p.accuracy,
      }))
    );

    if (!error) {
      await this.#offlineQueue.clear();
      console.info(`[GPS] ${pending.length} pontos offline enviados.`);
    }
  }

  // ── Utilitários (inalterados) ─────────────
  getRecentPoints(hours = 24) {
    const cutoff = Date.now() - hours * 3_600_000;
    return this.#points.filter(p => p.t >= cutoff);
  }

  exportCSV() {
    if (!this.#points.length) return false;

    const rows = ['Latitude,Longitude,Precisão(m),Horário'];
    this.#points.forEach(p => {
      const time = new Date(p.t).toLocaleString('pt-BR');
      rows.push(`${p.lat},${p.lon},${Math.round(p.acc)},"${time}"`);
    });

    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href:     url,
      download: `sentinel-gps-${new Date().toISOString().slice(0, 10)}.csv`,
    });
    a.click();
    URL.revokeObjectURL(url);
    return true;
  }

  clearHistory() {
    this.#points = [];
    localStorage.removeItem('sentinel_gps');
  }
}
