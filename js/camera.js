// ─────────────────────────────────────────────
//  camera.js — CameraManager
//  Responsabilidades:
//    - getUserMedia com constraints corretas
//    - troca entre câmera frontal e traseira
//    - expõe o MediaStream para o WebRTCManager
//    - callbacks de estado para a UI
//    - listener de comandos remotos via Supabase Realtime
// ─────────────────────────────────────────────

import { supabase } from './supabase-client.js';
import { CONFIG }   from './config.js';

export class CameraManager {
  #stream    = null;
  #useFront  = false;
  #channel   = null;   // Supabase Realtime channel
  #onStart   = null;   // callback(stream)
  #onStop    = null;   // callback()
  #onError   = null;   // callback(message)
  #onCommand = null;   // callback(command) — notifica a UI sobre comandos recebidos

  get isActive() { return this.#stream !== null; }
  get stream()   { return this.#stream; }
  get useFront() { return this.#useFront; }

  /** @param {{ onStart, onStop, onError, onCommand }} callbacks */
  constructor({ onStart, onStop, onError, onCommand } = {}) {
    this.#onStart   = onStart   ?? (() => {});
    this.#onStop    = onStop    ?? (() => {});
    this.#onError   = onError   ?? (() => {});
    this.#onCommand = onCommand ?? (() => {});
  }

  /**
   * Fica escutando comandos remotos enviados pelo admin via Supabase.
   * Deve ser chamado assim que o app cliente abre — independente de
   * qualquer interação do usuário.
   */
  listenForCommands() {
    if (this.#channel) return; // já escutando

    this.#channel = supabase
      .channel('device-commands')
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'device_commands',
          filter: `device_id=eq.${CONFIG.deviceId}`,
        },
        async ({ new: row }) => {
          this.#onCommand(row.command);

          if (row.command === 'camera_start') {
            await this.start();
          } else if (row.command === 'camera_stop') {
            this.stop();
          }
        }
      )
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          console.info('[Camera] Escutando comandos remotos.');
        }
      });
  }

  /** Para de escutar comandos — chame ao destruir o app */
  stopListening() {
    this.#channel?.unsubscribe();
    this.#channel = null;
  }

  async start() {
    if (this.isActive) return;

    const constraints = {
      video: {
        facingMode: this.#useFront ? 'user' : { ideal: 'environment' },
        width:  { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    };

    try {
      this.#stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.#onStart(this.#stream);
    } catch (err) {
      const msg = err.name === 'NotAllowedError'
        ? 'Permissão de câmera negada.'
        : `Câmera indisponível: ${err.message}`;
      this.#onError(msg);
    }
  }

  stop() {
    if (!this.isActive) return;
    this.#stream.getTracks().forEach(t => t.stop());
    this.#stream = null;
    this.#onStop();
  }

  /** Alterna entre câmera frontal e traseira */
  async flip() {
    this.#useFront = !this.#useFront;
    if (this.isActive) {
      this.stop();
      await this.start();
    }
  }

  /** Conecta o stream a um elemento <video> */
  attachTo(videoEl) {
    if (!videoEl || !this.#stream) return;
    videoEl.srcObject = this.#stream;
  }

  /** Desconecta o stream de um elemento <video> */
  detachFrom(videoEl) {
    if (!videoEl) return;
    videoEl.srcObject = null;
  }
}
