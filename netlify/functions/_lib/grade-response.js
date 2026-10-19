// Grades one writing or speaking response. Runs inside a background function.
// Safe to trigger more than once: only a pending response is claimed.
import { supabaseAdmin } from './supabase-admin.js';
import { getExam } from './exams.js';
import { getLlm, LlmError } from './llm.js';
import { getStt, transcribeAndLog } from './stt/index.js';
import { gradeWriting } from './graders/writing.js';
import { gradeSpeaking } from './graders/speaking.js';
import { AUDIO_BUCKET } from './attempts.js';
import { sectionForItem } from '../../../shared/diagnostic.js';

// When feedback becomes visible. Essay checks get their own policy in step 8.
export const releaseNow = (attempt) => ['diagnostic', 'practice', 'mock'].includes(attempt.mode);

export async function gradeResponse(responseId, deps = {}) {
  const db = deps.db ?? supabaseAdmin();

  const { data: claimed, error: claimErr } = await db
    .from('responses')
    .update({ grading_status: 'grading', grading_started_at: new Date().toISOString() })
    .eq('id', responseId)
    .in('grading_status', ['pending', 'awaiting_upload'])
    .select('*');
  if (claimErr) throw claimErr;
  const response = claimed?.[0];
  if (!response) return { skipped: true };

  const fail = async (code, err) => {
    if (err) console.error(`[grade] response ${responseId} failed: ${code}`, err);
    await db.from('responses').update({ grading_status: 'failed', ai_output_json: { error: code } }).eq('id', responseId);
    return { failed: code };
  };

  try {
    const { data: attempt } = await db.from('attempts').select('*').eq('id', response.attempt_id).single();
    const { data: item } = await db.from('items').select('*').eq('id', response.item_id).single();
    const exam = getExam(attempt.exam_code);
    const section = sectionForItem(attempt.plan_json, item.id);
    const usage = { userId: attempt.user_id, anonKey: attempt.anon_token };
    const llm = deps.llm ?? getLlm();

    let output;
    let transcript = null;
    if (item.skill === 'writing') {
      output = await gradeWriting({
        exam, item, text: response.answer_json?.text ?? '', locale: attempt.locale,
        wordLimits: section?.wordLimits, llm, usage,
      });
    } else if (item.skill === 'speaking') {
      const { data: blob, error: dlErr } = await db.storage.from(AUDIO_BUCKET).download(response.audio_path);
      if (dlErr || !blob) return fail('audio_missing', dlErr);
      const audio = new Uint8Array(await blob.arrayBuffer());
      const stt = deps.stt ?? getStt();
      const heard = await transcribeAndLog(
        stt,
        { audio, mimeType: response.answer_json?.mimeType || blob.type || 'audio/webm', language: exam.contentLanguage },
        { ...usage, operation: 'transcribe' }
      );
      transcript = heard.text;
      output = await gradeSpeaking({
        exam, item, transcript, durationSec: heard.durationSec, words: heard.words, locale: attempt.locale, llm, usage,
      });
    } else {
      return fail('not_gradable');
    }

    const now = new Date().toISOString();
    const { error: saveErr } = await db.from('responses').update({
      ai_output_json: output,
      transcript,
      score: output.score,
      max_score: output.max,
      grading_status: 'graded',
      graded_at: now,
      released_at: releaseNow(attempt) ? now : null,
    }).eq('id', responseId);
    if (saveErr) throw saveErr;
    return { graded: true, score: output.score };
  } catch (err) {
    return fail(err instanceof LlmError ? `llm_${err.code}` : 'grading_error', err);
  }
}
