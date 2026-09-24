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
    minInterval: 15_000,
    options: {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
    },
  },

  webrtc: {
    // STUN + TURN via Metered — funciona entre redes diferentes (dados móveis ↔ WiFi)
    iceServers: [
      { urls: 'stun:stun.relay.metered.ca:80' },
      {
        urls:       'turn:global.relay.metered.ca:80',
        username:   'd509ccafec3ba693ad59608c',
        credential: 'Wv5rr4Iv9waTwcpY',
      },
      {
        urls:       'turn:global.relay.metered.ca:80?transport=tcp',
        username:   'd509ccafec3ba693ad59608c',
        credential: 'Wv5rr4Iv9waTwcpY',
      },
      {
        urls:       'turn:global.relay.metered.ca:443',
        username:   'd509ccafec3ba693ad59608c',
        credential: 'Wv5rr4Iv9waTwcpY',
      },
      {
        urls:       'turns:global.relay.metered.ca:443?transport=tcp',
        username:   'd509ccafec3ba693ad59608c',
        credential: 'Wv5rr4Iv9waTwcpY',
      },
    ],
    roomId:       'main',
    pollInterval: 1_500,
  },
};
