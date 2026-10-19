// Who is calling? A logged-in user (Supabase JWT in Authorization: Bearer …)
// or an anonymous visitor (random token in X-Anon-Token, stored only as a hash).
import { createHash } from 'node:crypto';
import { supabaseAdmin } from './supabase-admin.js';
import { HttpError } from './http.js';
import { env } from './env.js';

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const ANON_TOKEN = /^[A-Za-z0-9-]{20,100}$/;

export function clientIp(req, context) {
  return context?.ip || req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
}

export async function getCaller(req, context) {
  const caller = { user: null, anonKey: null, ipKey: sha256(`${env('ANON_HASH_SALT', '')}|${clientIp(req, context)}`) };

  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    const { data, error } = await supabaseAdmin().auth.getUser(auth.slice(7));
    if (error || !data?.user) throw new HttpError(401, 'invalid_session');
    caller.user = data.user;
  }

  const anon = req.headers.get('x-anon-token');
  if (anon && ANON_TOKEN.test(anon)) caller.anonKey = sha256(anon);
  return caller;
}

export async function requireUser(req, context) {
  const caller = await getCaller(req, context);
  if (!caller.user) throw new HttpError(401, 'login_required');
  return caller;
}

export async function requireAdmin(req, context) {
  const caller = await requireUser(req, context);
  const { data } = await supabaseAdmin().from('profiles').select('is_admin').eq('id', caller.user.id).maybeSingle();
  if (!data?.is_admin) throw new HttpError(403, 'admin_only');
  return caller;
}

// The key that owns an attempt / usage row: user id if logged in, else anon hash.
export function ownerOf(caller) {
  if (caller.user) return { user_id: caller.user.id, anon_token: null };
  if (caller.anonKey) return { user_id: null, anon_token: caller.anonKey };
  throw new HttpError(400, 'anon_token_required');
}
