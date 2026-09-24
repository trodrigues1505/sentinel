// ─────────────────────────────────────────────
//  config.js — configurações centrais do app
//  Anon key é segura aqui pois RLS está ativo.
//  NUNCA coloque a service_role key neste arquivo.
// ─────────────────────────────────────────────

export const CONFIG = {
  supabase: {
    url: 'https://nujliwytwjdoumhbxmpx.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51amxpd3l0d2pkb3VtaGJ4bXB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNjIxMzksImV4cCI6MjEwNTgzODEzOX0.NiT0ykdq_QoizsuYS72--crN--km2t69GY2tFSKRmrQ',
  },

  // Room secret para proteger o painel admin.
  // O painel só carrega se a URL terminar com #7f4a9c2e1b8d3f6a
  adminSecret: '7f4a9c2e1b8d3f6a',

  // ID deste dispositivo — gerado uma vez e salvo no localStorage
  deviceId: localStorage.getItem('sentinel_device_id') ?? (() => {
    const id = crypto.randomUUID();
    localStorage.setItem('sentinel_device_id', id);
    return id;
  })(),

  gps: {
    // Intervalo mínimo entre pontos enviados ao Supabase (ms)
    minInterval: 15_000,
    options: {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
    },
  },

  webrtc: {
    // Servidores STUN públicos para negociação P2P
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
    // ID da sala — fixo para uso solo
    roomId: 'main',
    // Intervalo de polling para novos sinais WebRTC (ms)
    pollInterval: 1_500,
  },
};
