// ─────────────────────────────────────────────
//  ui.js — UIController
//  Responsabilidades:
//    - toasts
//    - troca de abas / views
//    - atualização de stats e mapa canvas
//    - estados de botões e badges
//  Não conhece GPSTracker, CameraManager nem WebRTC.
//  Recebe dados e atualiza o DOM — nada mais.
// ─────────────────────────────────────────────

export class UIController {
  #mapScale   = 180_000;
  #startTime  = Date.now();
  #uptimeId   = null;

  constructor() {
    this.#uptimeId = setInterval(() => this.#tickUptime(), 1_000);
  }

  // ── TOASTS ────────────────────────────────

  toast(message, type = 'info') {
    const icons = {
      success: '<polyline points="20,6 9,17 4,12"/>',
      error:   '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
      info:    '<line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    };
    const inner = icons[type] ?? icons.info;

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round">
        ${inner}
      </svg>
      <span>${message}</span>`;

    const container = document.getElementById('toast-container');
    container?.appendChild(el);
    setTimeout(() => el.remove(), 3_200);
  }

  // ── TABS ──────────────────────────────────

  switchTab(viewId) {
    document.querySelectorAll('.view').forEach(v =>
      v.classList.toggle('active', v.id === `view-${viewId}`)
    );
    document.querySelectorAll('.nav-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === viewId)
    );
  }

  // ── STATS ─────────────────────────────────

  setGPSCount(n) {
    this.#setText('stat-gps', n);
  }

  setLastGPSTime(date) {
    this.#setText('stat-gps-time', date.toLocaleTimeString('pt-BR'));
  }

  setCoords({ lat, lon, acc }) {
    this.#setText('coord-lat', lat.toFixed(6));
    this.#setText('coord-lon', lon.toFixed(6));
    this.#setText('coord-acc', Math.round(acc));
    this.#setText('map-coord', `${lat.toFixed(4)}, ${lon.toFixed(4)}`);

    this.#show('map-overlay');
    this.#hide('map-empty');
  }

  // ── CÂMERA ────────────────────────────────

  setCameraActive(active) {
    this.#toggle('cam-placeholder', !active);
    this.#toggle('cam-live-badge', active);
    this.#toggle('btn-cam-start',  !active);
    this.#toggle('btn-cam-stop',   active);
    this.#toggle('btn-cam-flip',   active);

    const chip = document.getElementById('cam-chip');
    if (chip) {
      chip.textContent  = active ? 'Ao vivo' : 'Inativa';
      chip.className    = active ? 'chip chip-green' : 'chip chip-gray';
    }

    this.#setText('stat-cam', active ? 'On' : 'Off');
  }

  attachVideo(stream) {
    const video = document.getElementById('cam-video');
    if (!video) return;
    video.srcObject = stream;
    video.style.display = 'block';
  }

  detachVideo() {
    const video = document.getElementById('cam-video');
    if (!video) return;
    video.srcObject = null;
    video.style.display = 'none';
  }

  // ── GPS TRACKING STATE ─────────────────────

  setTrackingActive(active) {
    this.#toggle('btn-gps-start', !active);
    this.#toggle('btn-gps-stop',  active);

    const pill = document.getElementById('status-pill');
    if (pill) {
      pill.textContent = active ? 'Rastreando' : 'Ativo';
      pill.className   = active ? 'status-pill tracking' : 'status-pill';
    }
  }

  // ── HISTORY ───────────────────────────────

  addHistoryItem({ lat, lon, acc, t }) {
    const list = document.getElementById('hist-list');
    if (!list) return;

    // Remove empty state na primeira entrada
    list.querySelector('.empty-state')?.remove();

    const time = new Date(t).toLocaleTimeString('pt-BR', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    const item = document.createElement('div');
    item.className = 'hist-item';
    item.innerHTML = `
      <div class="hist-icon">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
      </div>
      <div class="hist-body">
        <div class="hist-title">${lat.toFixed(5)}, ${lon.toFixed(5)}</div>
        <div class="hist-meta">±${Math.round(acc)}m</div>
      </div>
      <div class="hist-time">${time}</div>`;

    list.insertBefore(item, list.firstChild);
    if (list.children.length > 100) list.removeChild(list.lastChild);
  }

  clearHistoryUI() {
    const list = document.getElementById('hist-list');
    if (!list) return;
    list.innerHTML = `
      <div class="empty-state">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="1.5"
          stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12,6 12,12 16,14"/>
        </svg>
        <p>Sem registros</p>
        <span>Inicie o rastreamento</span>
      </div>`;
  }

  // ── MAPA ──────────────────────────────────

  drawMap(canvasId, points) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !points.length) return;

    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width  = W;
    canvas.height = H;

    // Fundo
    ctx.fillStyle = '#0d1017';
    ctx.fillRect(0, 0, W, H);

    // Grid sutil
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 36) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += 36) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    const last = points.at(-1);
    const toScreen = p => ({
      x: W / 2 + (p.lon - last.lon) * this.#mapScale,
      y: H / 2 - (p.lat - last.lat) * this.#mapScale,
    });

    // Trilha
    if (points.length > 1) {
      ctx.beginPath();
      const p0 = toScreen(points[0]);
      ctx.moveTo(p0.x, p0.y);
      points.slice(1).forEach(p => {
        const s = toScreen(p);
        ctx.lineTo(s.x, s.y);
      });
      ctx.strokeStyle = 'rgba(59,130,246,0.45)';
      ctx.lineWidth   = 2;
      ctx.stroke();
    }

    // Pontos anteriores
    points.slice(0, -1).forEach(p => {
      const s = toScreen(p);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(59,130,246,0.35)';
      ctx.fill();
    });

    // Marcador atual
    const cur = toScreen(last);
    ctx.beginPath();
    ctx.arc(cur.x, cur.y, 12, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(59,130,246,0.15)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cur.x, cur.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#3b82f6';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cur.x, cur.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }

  zoomMap(canvasId, points, factor) {
    this.#mapScale = Math.max(5_000, Math.min(2_000_000, this.#mapScale * factor));
    this.drawMap(canvasId, points);
  }

  // ── UPTIME ────────────────────────────────

  #tickUptime() {
    const s   = Math.floor((Date.now() - this.#startTime) / 1_000);
    const h   = Math.floor(s / 3_600);
    const m   = Math.floor((s % 3_600) / 60);
    const sec = s % 60;
    const str = h > 0
      ? `${this.#pad(h)}:${this.#pad(m)}:${this.#pad(sec)}`
      : `${this.#pad(m)}:${this.#pad(sec)}`;
    this.#setText('stat-uptime', str);
  }

  // ── HELPERS ───────────────────────────────

  #setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  #show(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  }

  #hide(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  #toggle(id, visible) {
    visible ? this.#show(id) : this.#hide(id);
  }

  #pad(n) { return String(n).padStart(2, '0'); }

  destroy() {
    clearInterval(this.#uptimeId);
  }
}
