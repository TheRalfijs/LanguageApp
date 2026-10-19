// POST /api/attempt-audio  { attemptId, itemId, mimeType }
// Creates the speaking response and a signed upload URL for its recording
// (bucket speaking-audio, private). Re-recording before grading reuses it.
import { handler, json, readJson, allowMethods, HttpError } from './_lib/http.js';
import { getCaller } from './_lib/auth.js';
import { enforceRateLimit } from './_lib/rate-limit.js';
import { supabaseAdmin } from './_lib/supabase-admin.js';
import { getExam } from './_lib/exams.js';
import { loadOwnedAttempt, loadItems, AUDIO_BUCKET } from './_lib/attempts.js';
import { sectionForItem, maxForTaskType } from '../../shared/diagnostic.js';

const TYPES = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/aac': 'aac', 'audio/x-m4a': 'm4a' };

export default handler(async (req, context) => {
  allowMethods(req, 'POST');
  const body = await readJson(req);
  const caller = await getCaller(req, context);
  const attempt = await loadOwnedAttempt(caller, body.attemptId);
  if (attempt.finished_at) throw new HttpError(409, 'attempt_finished');
  const exam = getExam(attempt.exam_code);

  const baseType = String(body.mimeType || '').split(';')[0].trim();
  const ext = TYPES[baseType];
  if (!ext) throw new HttpError(400, 'unsupported_audio_type');

  const item = (await loadItems([body.itemId])).get(body.itemId);
  if (!item || item.skill !== 'speaking' || !sectionForItem(attempt.plan_json, item.id)) {
    throw new HttpError(400, 'item_not_in_attempt');
  }

  const db = supabaseAdmin();
  let { data: response } = await db.from('responses').select('id, grading_status')
    .eq('attempt_id', attempt.id).eq('item_id', item.id).maybeSingle();

  if (response && response.grading_status !== 'awaiting_upload') throw new HttpError(409, 'already_answered');
  if (!response) {
    // One speaking grading = one transcription + one AI grading.
    await enforceRateLimit(caller, 'transcription');
    await enforceRateLimit(caller, 'grading');
    const ins = await db.from('responses').insert({
      attempt_id: attempt.id, item_id: item.id, grading_status: 'awaiting_upload',
      max_score: maxForTaskType(exam, item.task_type), answer_json: { mimeType: baseType },
    }).select('id, grading_status').single();
    if (ins.error) throw ins.error;
    response = ins.data;
  }

  const path = `${attempt.id}/${response.id}.${ext}`;
  await db.from('responses').update({ audio_path: path, answer_json: { mimeType: baseType } }).eq('id', response.id);
  const { data: signed, error } = await db.storage.from(AUDIO_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error) throw error;
  return json(200, { responseId: response.id, uploadUrl: signed.signedUrl });
});

export const config = { path: '/api/attempt-audio' };
