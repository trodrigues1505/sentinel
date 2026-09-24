// ─────────────────────────────────────────────
//  webrtc.js — WebRTCManager
//  Responsabilidades:
//    - criar/aceitar conexão P2P via RTCPeerConnection
//    - sinalização (offer/answer/ICE) via Supabase Realtime
//    - expor o stream remoto recebido (lado admin)
//    - limpar sinais antigos após conexão
// ─────────────────────────────────────────────

import { supabase } from './supabase-client.js';
import { CONFIG }   from './config.js';

export class WebRTCManager {
  #pc          = null;   // RTCPeerConnection
  #role        = null;   // 'caller' | 'callee'
  #channel     = null;   // Supabase Realtime channel
  #onStream    = null;   // callback(MediaStream) — admin recebe o stream
  #onStatus    = null;   // callback(state: string)
  #onError     = null;   // callback(message)

  get isConnected() {
    return this.#pc?.connectionState === 'connected';
  }

  /** @param {'caller'|'callee'} role  caller = cliente, callee = admin */
  constructor(role, { onStream, onStatus, onError } = {}) {
    this.#role     = role;
    this.#onStream = onStream ?? (() => {});
    this.#onStatus = onStatus ?? (() => {});
    this.#onError  = onError  ?? (() => {});
  }

  /** Inicia a conexão. O caller adiciona tracks antes de chamar este método. */
  async connect(localStream = null) {
    this.#pc = new RTCPeerConnection({ iceServers: CONFIG.webrtc.iceServers });

    // Adiciona tracks locais (lado cliente)
    if (localStream) {
      localStream.getTracks().forEach(t => this.#pc.addTrack(t, localStream));
    }

    // Recebe stream remoto (lado admin)
    this.#pc.ontrack = ({ streams }) => {
      if (streams[0]) this.#onStream(streams[0]);
    };

    // Mudanças de estado de conexão
    this.#pc.onconnectionstatechange = () => {
      this.#onStatus(this.#pc.connectionState);
    };

    // Candidatos ICE → envia ao Supabase
    this.#pc.onicecandidate = async ({ candidate }) => {
      if (!candidate) return;
      await this.#sendSignal('candidate', candidate.toJSON());
    };

    // Inscreve no canal Realtime para receber sinais
    await this.#subscribeToSignals();

    if (this.#role === 'caller') {
      await this.#createOffer();
    }
    // Callee aguarda o offer chegar via Realtime
  }

  async #createOffer() {
    const offer = await this.#pc.createOffer();
    await this.#pc.setLocalDescription(offer);
    await this.#sendSignal('offer', { sdp: offer.sdp, type: offer.type });
  }

  async #handleSignal(signal) {
    try {
      if (signal.type === 'offer' && this.#role === 'callee') {
        await this.#pc.setRemoteDescription(
          new RTCSessionDescription(signal.payload)
        );
        const answer = await this.#pc.createAnswer();
        await this.#pc.setLocalDescription(answer);
        await this.#sendSignal('answer', { sdp: answer.sdp, type: answer.type });

      } else if (signal.type === 'answer' && this.#role === 'caller') {
        await this.#pc.setRemoteDescription(
          new RTCSessionDescription(signal.payload)
        );

      } else if (signal.type === 'candidate') {
        await this.#pc.addIceCandidate(new RTCIceCandidate(signal.payload));
      }
    } catch (err) {
      this.#onError(`Sinalização WebRTC: ${err.message}`);
    }
  }

  async #subscribeToSignals() {
    // Busca sinais existentes primeiro (para o callee pegar o offer)
    const { data: existing } = await supabase
      .from('webrtc_signals')
      .select('*')
      .eq('room_id', CONFIG.webrtc.roomId)
      .neq('sender', this.#role)
      .order('created_at', { ascending: true });

    for (const signal of existing ?? []) {
      await this.#handleSignal(signal);
    }

    // Escuta novos sinais via Realtime
    this.#channel = supabase
      .channel(`webrtc:${CONFIG.webrtc.roomId}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'webrtc_signals',
          filter: `room_id=eq.${CONFIG.webrtc.roomId}`,
        },
        async ({ new: signal }) => {
          if (signal.sender !== this.#role) {
            await this.#handleSignal(signal);
          }
        }
      )
      .subscribe();
  }

  async #sendSignal(type, payload) {
    const { error } = await supabase
      .from('webrtc_signals')
      .insert({
        room_id: CONFIG.webrtc.roomId,
        sender:  this.#role,
        type,
        payload,
      });

    if (error) this.#onError(`Erro ao enviar sinal: ${error.message}`);
  }

  disconnect() {
    this.#channel?.unsubscribe();
    this.#pc?.close();
    this.#pc      = null;
    this.#channel = null;
  }

  /** Limpa sinais antigos desta sala do Supabase */
  static async clearSignals() {
    await supabase
      .from('webrtc_signals')
      .delete()
      .eq('room_id', CONFIG.webrtc.roomId);
  }
}
