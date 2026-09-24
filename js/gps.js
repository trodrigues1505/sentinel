// ─────────────────────────────────────────────
//  gps.js — GPSTracker
//  Responsabilidades:
//    - watchPosition com alta precisão
//    - throttle de envio ao Supabase
//    - histórico local em memória (máx 500 pts)
//    - exportação CSV
//    - callbacks para atualização de UI
// ─────────────────────────────────────────────

import { supabase } from './supabase-client.js';
import { CONFIG } from './config.js';

export class GPSTracker {
  #watchId       = null;
  #lastSentAt    = 0;
  #points        = [];        // { lat, lon, acc, t }
  #onUpdate      = null;      // callback(point)
  #onError       = null;      // callback(message)

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
  }

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
  }

  stop() {
    if (!this.isTracking) return;
    navigator.geolocation.clearWatch(this.#watchId);
    this.#watchId = null;
  }

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
    const { error } = await supabase
      .from('gps_points')
      .insert({
        device_id: CONFIG.deviceId,
        lat:       point.lat,
        lon:       point.lon,
        accuracy:  point.acc,
      });

    if (error) console.warn('[GPS] Erro ao enviar:', error.message);
  }

  /** Retorna os pontos das últimas N horas */
  getRecentPoints(hours = 24) {
    const cutoff = Date.now() - hours * 3_600_000;
    return this.#points.filter(p => p.t >= cutoff);
  }

  /** Exporta o histórico como CSV e dispara o download */
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
