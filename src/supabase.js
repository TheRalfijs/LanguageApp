// Browser Supabase client. Uses the PUBLIC anon key only; RLS protects data.
import { createClient } from '@supabase/supabase-js';
import { AUTH_STORAGE_KEY } from './auth-hint.js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && anonKey
  ? createClient(url, anonKey, {
      auth: {
        storageKey: AUTH_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Implicit flow: the magic link also works when the email app opens it
        // in a different browser than the one that requested it (common on Android).
        flowType: 'implicit',
      },
    })
  : null;

if (!supabase) console.warn('Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env');
