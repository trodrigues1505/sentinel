// ─────────────────────────────────────────────
//  supabase-client.js — instância única do Supabase
//  Importar este módulo em qualquer lugar retorna
//  sempre o mesmo cliente (singleton).
// ─────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CONFIG } from './config.js';

export const supabase = createClient(
  CONFIG.supabase.url,
  CONFIG.supabase.anonKey,
  {
    realtime: { params: { eventsPerSecond: 2 } },
  }
);
