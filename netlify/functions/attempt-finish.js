// POST /api/attempt-finish  { attemptId } — no more answers after this.
import { handler, json, readJson, allowMethods } from './_lib/http.js';
import { getCaller } from './_lib/auth.js';
import { supabaseAdmin } from './_lib/supabase-admin.js';
import { loadOwnedAttempt } from './_lib/attempts.js';

export default handler(async (req, context) => {
  allowMethods(req, 'POST');
  const body = await readJson(req);
  const caller = await getCaller(req, context);
  const attempt = await loadOwnedAttempt(caller, body.attemptId);
  if (!attempt.finished_at) {
    const { error } = await supabaseAdmin().from('attempts')
      .update({ finished_at: new Date().toISOString() }).eq('id', attempt.id).is('finished_at', null);
    if (error) throw error;
  }
  return json(200, { finished: true });
});

export const config = { path: '/api/attempt-finish' };
