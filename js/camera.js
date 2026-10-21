// ─────────────────────────────────────────────
//  camera.js — CameraManager
//  Responsabilidades:
//    - getUserMedia: câmera e/ou microfone
//    - troca entre câmera frontal e traseira
//    - expõe MediaStream para o WebRTCManager
//    - listener de comandos remotos via Supabase
//
//  PROBLEMA 3 — câmera fecha com descanso de tela:
//    Quando a tela apaga, o SO suspende as MediaTracks.
//    As tracks ficam com readyState === 'ended', o que
//    derruba o WebRTC e dispara onStop.
//    Solução: monitorar o 'ended' em cada track e, ao
//    retornar ao app (visibilitychange), verificar se
//    a stream ainda está viva e reconectar se necessário.
// ─────────────────────────────────────────────

import { supabase } from './supabase-client.js';
import { CONFIG }   from './config.js';

export class CameraManager {
  #camStream      = null;
  #micStream      = null;
  #useFront       = false;
  #channel        = null;
  #onStart        = null;
  #onStop         = null;
  #onError        = null;
  #onCommand      = null;
  #lastMode       = null;   // 'camera' | 'mic' — para reconectar após tela apagar
  #reconnecting   = false;  // evita reconexões simultâneas

  get isCamActive() { return this.#camStream !== null; }
  get isMicActive() { return this.#micStream !== null; }
  get camStream()   { return this.#camStream; }
  get micStream()   { return this.#micStream; }
  get usingFront()  { return this.#useFront; }

  constructor({ onStart, onStop, onError, onCommand } = {}) {
    this.#onStart   = onStart   ?? (() => {});
    this.#onStop    = onStop    ?? (() => {});
    this.#onError   = onError   ?? (() => {});
    this.#onCommand = onCommand ?? (() => {});

    // PROBLEMA 3: ao voltar para o app, verifica se a stream
    // foi interrompida pela tela apagando e reconecta.
    document.addEventListener('visibilitychange', this.#handleVisibilityChange);
  }

  // ── PROBLEMA 3: reconexão ao voltar ao app ─
  #handleVisibilityChange = async () => {
    if (document.visibilityState !== 'visible') return;
    if (this.#reconnecting) return;

    const camDead = this.#camStream && this.#isStreamDead(this.#camStream);
    const micDead = this.#micStream && this.#isStreamDead(this.#micStream);

    if (!camDead && !micDead) return; // tudo ok, não precisa reconectar

    this.#reconnecting = true;
    try {
      if (camDead) {
        this.#camStream.getTracks().forEach(t => t.stop());
        this.#camStream = null;
        await this.startCamera({ silent: true });
      }
      if (micDead) {
        this.#micStream.getTracks().forEach(t => t.stop());
        this.#micStream = null;
        await this.startMic({ silent: true });
      }
    } catch {
      if (this.#lastMode === 'camera') this.#onStop('camera');
      if (this.#lastMode === 'mic')    this.#onStop('mic');
    } finally {
      this.#reconnecting = false;
    }
  };

  #isStreamDead(stream) {
    const tracks = stream.getTracks();
    return tracks.length > 0 && tracks.every(t => t.readyState === 'ended');
  }

  // ── Câmera ────────────────────────────────

  async startCamera({ silent = false } = {}) {
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

      this.#camStream.getVideoTracks().forEach(track => {
        track.addEventListener('ended', () => {
          if (this.#camStream) {
            this.#camStream = null;
            if (!this.#reconnecting) this.#onStop('camera');
          }
        });
      });

      this.#lastMode = 'camera';
      this.#onStart(this.#camStream, 'camera', silent);
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
    this.#lastMode  = null;
    this.#onStop('camera');
  }

  // NOVO: separa a troca de câmera em um método explícito,
  // reaproveitado tanto pelo flip local quanto pelo comando remoto.
  // silent=true evita o onStop/onStart "piscar" a UI inteira —
  // só troca o stream por baixo.
  async setFacing(front, { silent = false } = {}) {
    if (this.#useFront === front) return;
    this.#useFront = front;
    if (!this.isCamActive) return; // nada ligado, só guarda a preferência
    this.#camStream.getTracks().forEach(t => t.stop());
    this.#camStream = null;
    if (!silent) this.#onStop('camera'); // reseta UI antes de reabrir
    await this.startCamera({ silent });
  }

  async flip() {
    await this.setFacing(!this.#useFront);
  }

  // ── Microfone ─────────────────────────────

  async startMic({ silent = false } = {}) {
    if (this.isMicActive) return;
    try {
      this.#micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });

      this.#micStream.getAudioTracks().forEach(track => {
        track.addEventListener('ended', () => {
          if (this.#micStream) {
            this.#micStream = null;
            if (!this.#reconnecting) this.#onStop('mic');
          }
        });
      });

      this.#lastMode = 'mic';
      this.#onStart(this.#micStream, 'mic', silent);
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
    this.#lastMode  = null;
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

  static requestFullscreen(videoEl) {
    if (!videoEl) return;
    if (typeof videoEl.webkitEnterFullscreen === 'function') {
      videoEl.webkitEnterFullscreen();
      return;
    }
    const el = videoEl.closest('.cam-wrap') ?? videoEl;
    if (el.requestFullscreen)            { el.requestFullscreen(); return; }
    if (el.webkitRequestFullscreen)      { el.webkitRequestFullscreen(); return; }
    if (el.mozRequestFullScreen)         { el.mozRequestFullScreen(); return; }
    if (el.msRequestFullscreen)          { el.msRequestFullscreen(); return; }

    if (videoEl.srcObject) {
      const stream = videoEl.srcObject;
      const tmpVideo = document.createElement('video');
      tmpVideo.srcObject = stream;
      tmpVideo.autoplay  = true;
      tmpVideo.controls  = true;
      tmpVideo.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;background:#000;z-index:99999';
      document.body.appendChild(tmpVideo);

      const close = () => { tmpVideo.remove(); document.removeEventListener('keydown', onKey); };
      const onKey = e => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', onKey);
      tmpVideo.addEventListener('click', close);
    }
  }

  static exitFullscreen() {
    if (document.exitFullscreen)            { document.exitFullscreen(); return; }
    if (document.webkitExitFullscreen)      { document.webkitExitFullscreen(); return; }
    if (document.mozCancelFullScreen)       { document.mozCancelFullScreen(); return; }
    if (document.msExitFullscreen)          { document.msExitFullscreen(); return; }
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
            case 'camera_start':              await this.startCamera(); break;
            case 'camera_stop':                     this.stopCamera();  break;
            case 'mic_start':                 await this.startMic();    break;
            case 'mic_stop':                         this.stopMic();    break;
            // NOVO — necessário para o admin controlar frontal/traseira
            case 'camera_facing_user':        await this.setFacing(true);  break;
            case 'camera_facing_environment': await this.setFacing(false); break;
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

  destroy() {
    this.stopCamera();
    this.stopMic();
    this.stopListening();
    document.removeEventListener('visibilitychange', this.#handleVisibilityChange);
  }
}
