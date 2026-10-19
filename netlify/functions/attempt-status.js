// GET /api/attempt-status?id=<attemptId>
// Progress + per-skill estimate. Full feedback only for the logged-in owner
// (anonymous visitors see the estimate and are asked for their email).
import { handler, json, allowMethods, HttpError } from './_lib/http.js';
import { getCaller } from './_lib/auth.js';
import { supabaseAdmin } from './_lib/supabase-admin.js';
import { getExam } from './_lib/exams.js';
import { loadOwnedAttempt, loadItems, allPlanItemIds } from './_lib/attempts.js';
import { summarizeAttempt, responseState } from '../../shared/diagnostic.js';
import { publicItem } from '../../shared/items.js';

export default handler(async (req, context) => {
  allowMethods(req, 'GET');
  const id = new URL(req.url).searchParams.get('id');
  if (!id) throw new HttpError(400, 'invalid_attempt');
  const caller = await getCaller(req, context);
  const attempt = await loadOwnedAttempt(caller, id);
  const exam = getExam(attempt.exam_code);
  const db = supabaseAdmin();

  const { data: responses, error } = await db.from('responses').select('*').eq('attempt_id', attempt.id);
  if (error) throw error;
  const summary = summarizeAttempt({ exam, attempt, responses });

  if (summary.complete && !attempt.skill_scores_json) {
    await db.from('attempts').update({
      skill_scores_json: { skillPoints: summary.skillPoints, result: summary.result, computedAt: new Date().toISOString() },
    }).eq('id', attempt.id);
  }

  const items = await loadItems(allPlanItemIds(attempt.plan_json), { withKey: true });
  const skillOf = new Map([...items.values()].map((it) => [it.id, it.skill]));
  const isUserOwner = Boolean(caller.user && attempt.user_id === caller.user.id);

  return json(200, {
    attemptId: attempt.id,
    mode: attempt.mode,
    finished: Boolean(attempt.finished_at),
    complete: summary.complete,
    pendingCount: summary.pendingCount,
    failed: responses
      .filter((r) => responseState(r) === 'failed')
      .map((r) => ({ responseId: r.id, skill: skillOf.get(r.item_id), retryable: r.ai_output_json?.error !== 'audio_missing' })),
    result: summary.result && {
      passed: summary.result.passed,
      weakestSkill: summary.result.weakestSkill,
      missing: summary.result.missing,
      skills: summary.result.skills,
    },
    feedbackLocked: !isUserOwner,
    // Answer keys and listening scripts only after the attempt is finished.
    feedback: isUserOwner && attempt.finished_at ? buildFeedback(attempt.plan_json, items, responses) : null,
  });
});

function buildFeedback(plan, items, responses) {
  const byItem = new Map(responses.map((r) => [r.item_id, r]));
  return plan.sections.map((section) => ({
    skill: section.skill,
    taskType: section.taskType,
    items: section.itemIds.map((id) => {
      const item = items.get(id);
      const r = byItem.get(id);
      const pub = publicItem(item);
      const released = r?.released_at ? r : null;
      if (section.skill === 'reading' || section.skill === 'listening') {
        return {
          ...pub,
          chosen: r?.answer_json?.choice ?? null,
          correctIndex: item.answer_key_json?.correct ?? null,
          isCorrect: Boolean(r && Number(r.score) > 0),
          ...(item.content_json.audio ? { script: item.content_json.audio.segments.map((s) => s.text).join('\n') } : {}),
        };
      }
      if (section.skill === 'writing') {
        return { ...pub, text: r?.answer_json?.text ?? null, status: r?.grading_status ?? 'missing', output: released?.ai_output_json ?? null };
      }
      return { ...pub, transcript: released?.transcript ?? null, status: r?.grading_status ?? 'missing', output: released?.ai_output_json ?? null };
    }),
  }));
}

export const config = { path: '/api/attempt-status' };
