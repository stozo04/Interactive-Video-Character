// server/services/supabaseAdmin.ts
//
// Server-side Supabase client using the service role key.
// Bypasses RLS entirely — appropriate for trusted server processes (WA bridge, schedulers).
//
// NEVER import this in browser code. The service role key has full DB access
// and must stay server-side only (it's in process.env, not VITE_*).

import { createClient } from '@supabase/supabase-js';

const supabaseUrl      = process.env.VITE_SUPABASE_URL;
const serviceRoleKey   = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl)    throw new Error('[supabaseAdmin] Missing VITE_SUPABASE_URL');
if (!serviceRoleKey) throw new Error('[supabaseAdmin] Missing SUPABASE_SERVICE_ROLE_KEY — add it to .env.local');

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    // Service role clients don't need to persist sessions
    persistSession: false,
    autoRefreshToken: false,
  },
});
