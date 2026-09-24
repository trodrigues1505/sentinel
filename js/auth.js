// ─────────────────────────────────────────────
//  auth.js — guarda de acesso ao painel admin
//  Verifica se o hash da URL bate com o secret.
//  Sem o secret correto, o painel não carrega.
// ─────────────────────────────────────────────

import { CONFIG } from './config.js';

export class AuthGuard {
  /** Retorna true se o acesso está autorizado */
  static isAuthorized() {
    const hash = window.location.hash.replace('#', '').trim();
    return hash === CONFIG.adminSecret;
  }

  /**
   * Bloqueia o acesso se não autorizado.
   * Substitui todo o body por uma tela de bloqueio.
   */
  static enforce() {
    if (this.isAuthorized()) return true;

    document.body.innerHTML = `
      <div style="
        height:100dvh;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        gap:16px;
        background:#0a0c10;
        color:#3e4455;
        font-family:system-ui,sans-serif;
        text-align:center;
        padding:24px;
      ">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="1.5"
          stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0110 0v4"/>
        </svg>
        <p style="font-size:14px;color:#7c8394">Acesso não autorizado</p>
      </div>`;

    return false;
  }
}
