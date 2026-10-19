// Service-role Supabase client: bypasses RLS. Server only — never import from src/.
import { createClient } from '@supabase/supabase-js';
import { requireEnv } from './env.js';

let client = null;

export function supabaseAdmin() {
  client ??= createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

// Tests inject a fake.
export function setSupabaseAdminForTests(fake) {
  client = fake;
}
