// POST /api/attempt-claim — after login, move this browser's anonymous
// attempts (and their AI cost rows) to the user's account.
import { handler, json, allowMethods } from './_lib/http.js';
import { requireUser } from './_lib/auth.js';
import { supabaseAdmin } from './_lib/supabase-admin.js';

export default handler(async (req, context) => {
  allowMethods(req, 'POST');
  const caller = await requireUser(req, context);
  if (!caller.anonKey) return json(200, { claimed: 0 });

  const db = supabaseAdmin();
  const { data, error } = await db.from('attempts')
    .update({ user_id: caller.user.id, anon_token: null })
    .eq('anon_token', caller.anonKey)
    .is('user_id', null)
    .select('id');
  if (error) throw error;

  await db.from('ai_usage').update({ user_id: caller.user.id })
    .eq('anon_key', caller.anonKey).is('user_id', null);

  return json(200, { claimed: data.length, attemptIds: data.map((a) => a.id) });
});

export const config = { path: '/api/attempt-claim' };
