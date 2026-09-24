// ─────────────────────────────────────────────
//  camera.js — CameraManager
//  Responsabilidades:
//    - getUserMedia: câmera e/ou microfone
//    - troca entre câmera frontal e traseira
//    - expõe MediaStream para o WebRTCManager
//    - listener de comandos remotos via Supabase
// ─────────────────────────────────────────────

import { supabase } from './supabase-client.js';
import { CONFIG }   from './config.js';

export class CameraManager {
  #camStream  = null;   // stream só de vídeo
  #micStream  = null;   // stream só de áudio
  #useFront   = false;
  #channel    = null;
  #onStart    = null;   // callback(stream, mode) — mode: 'camera'|'mic'
  #onStop     = null;   // callback(mode)
  #onError    = null;   // callback(message)
  #onCommand  = null;   // callback(command)

  get isCamActive() { return this.#camStream !== null; }
  get isMicActive() { return this.#micStream !== null; }
  get camStream()   { return this.#camStream; }
  get micStream()   { return this.#micStream; }

  constructor({ onStart, onStop, onError, onCommand } = {}) {
    this.#onStart   = onStart   ?? (() => {});
    this.#onStop    = onStop    ?? (() => {});
    this.#onError   = onError   ?? (() => {});
    this.#onCommand = onCommand ?? (() => {});
  }

  // ── Câmera ────────────────────────────────

  async startCamera() {
    if (this.isCamActive) return;
    try {
      this.#camStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: this.#useFront ? 'user' : { ideal: 'environment' },
          width:  { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      this.#onStart(this.#camStream, 'camera');
    } catch (err) {
      this.#onError(err.name === 'NotAllowedError'
        ? 'Permissão de câmera negada.'
        : `Câmera indisponível: ${err.message}`);
    }
  }

  stopCamera() {
    if (!this.isCamActive) return;
    this.#camStream.getTracks().forEach(t => t.stop());
    this.#camStream = null;
    this.#onStop('camera');
  }

  async flip() {
    this.#useFront = !this.#useFront;
    if (this.isCamActive) {
      this.stopCamera();
      await this.startCamera();
    }
  }

  // ── Microfone ─────────────────────────────

  async startMic() {
    if (this.isMicActive) return;
    try {
      this.#micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      this.#onStart(this.#micStream, 'mic');
    } catch (err) {
      this.#onError(err.name === 'NotAllowedError'
        ? 'Permissão de microfone negada.'
        : `Microfone indisponível: ${err.message}`);
    }
  }

  stopMic() {
    if (!this.isMicActive) return;
    this.#micStream.getTracks().forEach(t => t.stop());
    this.#micStream = null;
    this.#onStop('mic');
  }

  // ── Helpers ───────────────────────────────

  attachTo(videoEl) {
    if (!videoEl || !this.#camStream) return;
    videoEl.srcObject = this.#camStream;
  }

  detachFrom(videoEl) {
    if (!videoEl) return;
    videoEl.srcObject = null;
  }

  // ── Comandos remotos ──────────────────────

  listenForCommands() {
    if (this.#channel) return;

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

          switch (row.command) {
            case 'camera_start': await this.startCamera(); break;
            case 'camera_stop':        this.stopCamera();  break;
            case 'mic_start':   await this.startMic();    break;
            case 'mic_stop':           this.stopMic();    break;
          }
        }
      )
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          console.info('[Camera] Escutando comandos remotos.');
        }
      });
  }

  stopListening() {
    this.#channel?.unsubscribe();
    this.#channel = null;
  }
}
