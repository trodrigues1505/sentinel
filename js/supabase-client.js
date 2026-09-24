// ─────────────────────────────────────────────
//  supabase-client.js — instância única do Supabase
//  Credenciais inline para evitar problemas de
//  resolução de caminho relativo em subdiretórios.
// ─────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = 'https://nujliwytwjdoumhbxmpx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51amxpd3l0d2pkb3VtaGJ4bXB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNjIxMzksImV4cCI6MjEwNTgzODEzOX0.NiT0ykdq_QoizsuYS72--crN--km2t69GY2tFSKRmrQ';

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    realtime: { params: { eventsPerSecond: 2 } },
  }
);
