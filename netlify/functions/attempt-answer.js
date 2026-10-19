// POST /api/attempt-answer
//   { attemptId, answers: [{ itemId, choice }] }   objective answers (scored now)
//   { attemptId, itemId, text }                    writing (graded in background)
//   { attemptId, retry: responseId }               re-queue a failed grading
// Writing/retry return { responseId }; the browser then triggers
// /.netlify/functions/grade-response-background with it.
import { handler, json, readJson, allowMethods, HttpError } from './_lib/http.js';
import { getCaller } from './_lib/auth.js';
import { enforceRateLimit } from './_lib/rate-limit.js';
import { supabaseAdmin } from './_lib/supabase-admin.js';
import { getExam } from './_lib/exams.js';
import { loadOwnedAttempt, loadItems } from './_lib/attempts.js';
import { sectionForItem, maxForTaskType, responseState } from '../../shared/diagnostic.js';
import { scoreObjective } from '../../shared/items.js';
import { getTaskType } from '../../shared/exam-config.js';

const MAX_TEXT = 6000;

export default handler(async (req, context) => {
  allowMethods(req, 'POST');
  const body = await readJson(req, { maxBytes: 32 * 1024 });
  const caller = await getCaller(req, context);
  const attempt = await loadOwnedAttempt(caller, body.attemptId);
  const exam = getExam(attempt.exam_code);
  const db = supabaseAdmin();

  if (body.retry) return retry(db, caller, attempt, body.retry);
  if (attempt.finished_at) throw new HttpError(409, 'attempt_finished');

  if (Array.isArray(body.answers)) {
    const ids = body.answers.map((a) => a.itemId);
    const items = await loadItems(ids, { withKey: true });
    const now = new Date().toISOString();
    const rows = body.answers.map((a) => {
      const item = items.get(a.itemId);
      const section = item && sectionForItem(attempt.plan_json, item.id);
      if (!section) throw new HttpError(400, 'item_not_in_attempt');
      const tt = getTaskType(exam, item.task_type);
      if (tt.rubric) throw new HttpError(400, 'not_objective');
      const choice = Number.isInteger(a.choice) ? a.choice : null;
      const s = scoreObjective(item, { choice }, tt.pointsPerItem);
      return {
        attempt_id: attempt.id, item_id: item.id, answer_json: { choice },
        score: s.score, max_score: s.max, grading_status: 'not_needed', graded_at: now, released_at: now,
      };
    });
    // Answers are final: a second submission for the same item is ignored.
    const { error } = await db.from('responses').upsert(rows, { onConflict: 'attempt_id,item_id', ignoreDuplicates: true });
    if (error) throw error;
    return json(200, { saved: rows.length });
  }

  if (typeof body.itemId === 'string' && typeof body.text === 'string') {
    if (body.text.length > MAX_TEXT) throw new HttpError(413, 'text_too_long');
    const items = await loadItems([body.itemId]);
    const item = items.get(body.itemId);
    if (!item || !sectionForItem(attempt.plan_json, item.id) || item.skill !== 'writing') {
      throw new HttpError(400, 'item_not_in_attempt');
    }
    await enforceRateLimit(caller, 'grading');
    const { data, error } = await db.from('responses').insert({
      attempt_id: attempt.id, item_id: item.id, answer_json: { text: body.text },
      max_score: maxForTaskType(exam, item.task_type), grading_status: 'pending',
    }).select('id').single();
    if (error?.code === '23505') throw new HttpError(409, 'already_answered');
    if (error) throw error;
    return json(201, { responseId: data.id });
  }

  throw new HttpError(400, 'invalid_request');
});

async function retry(db, caller, attempt, responseId) {
  const { data: r } = await db.from('responses').select('*').eq('id', responseId).eq('attempt_id', attempt.id).maybeSingle();
  if (!r) throw new HttpError(404, 'response_not_found');
  if (responseState(r) !== 'failed') throw new HttpError(409, 'not_failed');
  if (r.ai_output_json?.error === 'audio_missing') throw new HttpError(409, 'audio_missing');
  await enforceRateLimit(caller, 'grading');
  const { error } = await db.from('responses').update({ grading_status: 'pending', grading_started_at: null }).eq('id', r.id);
  if (error) throw error;
  return json(200, { responseId: r.id });
}

export const config = { path: '/api/attempt-answer' };
