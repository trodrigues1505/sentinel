// ─────────────────────────────────────────────
//  camera.js — CameraManager
//  Responsabilidades:
//    - getUserMedia com constraints corretas
//    - troca entre câmera frontal e traseira
//    - expõe o MediaStream para o WebRTCManager
//    - callbacks de estado para a UI
// ─────────────────────────────────────────────

export class CameraManager {
  #stream    = null;
  #useFront  = false;
  #onStart   = null;   // callback(stream)
  #onStop    = null;   // callback()
  #onError   = null;   // callback(message)

  get isActive() { return this.#stream !== null; }
  get stream()   { return this.#stream; }
  get useFront() { return this.#useFront; }

  /** @param {{ onStart, onStop, onError }} callbacks */
  constructor({ onStart, onStop, onError } = {}) {
    this.#onStart = onStart ?? (() => {});
    this.#onStop  = onStop  ?? (() => {});
    this.#onError = onError ?? (() => {});
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
