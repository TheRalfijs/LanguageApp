// POST /api/attempt-start  { exam?: 'lv-b1', locale?: 'uk' }
// Starts a free diagnostic: picks approved items, returns them without answers.
import appConfig from '../../config/app.json' with { type: 'json' };
import { handler, json, readJson, allowMethods } from './_lib/http.js';
import { getCaller, ownerOf } from './_lib/auth.js';
import { enforceRateLimit } from './_lib/rate-limit.js';
import { supabaseAdmin } from './_lib/supabase-admin.js';
import { getExam } from './_lib/exams.js';
import { publicAudioUrl } from './_lib/attempts.js';
import { pickDiagnosticItems } from '../../shared/diagnostic.js';
import { publicItem } from '../../shared/items.js';
import { getRubric, getTaskType } from '../../shared/exam-config.js';

export default handler(async (req, context) => {
  allowMethods(req, 'POST');
  const body = await readJson(req);
  const exam = getExam(body.exam || appConfig.defaultExam);
  const locale = appConfig.ENABLED_LOCALES.includes(body.locale) ? body.locale : appConfig.DEFAULT_LOCALE;

  const caller = await getCaller(req, context);
  const owner = ownerOf(caller);
  await enforceRateLimit(caller, 'diagnosticStart');

  const db = supabaseAdmin();
  const taskTypes = [...new Set(exam.diagnostic.sections.map((s) => s.taskType))];
  const { data: items, error } = await db
    .from('items')
    .select('id, skill, task_type, content_json, audio_path')
    .eq('exam_code', exam.code)
    .eq('status', 'approved')
    .in('task_type', taskTypes);
  if (error) throw error;

  const byType = {};
  for (const it of items) (byType[it.task_type] ??= []).push(it);
  const plan = pickDiagnosticItems(exam, byType);

  const { data: attempt, error: insErr } = await db
    .from('attempts')
    .insert({ ...owner, mode: 'diagnostic', exam_code: exam.code, plan_json: plan, locale })
    .select('id, started_at')
    .single();
  if (insErr) throw insErr;

  const byId = new Map(items.map((it) => [it.id, it]));
  return json(201, {
    attemptId: attempt.id,
    exam: { code: exam.code, minRatio: exam.passRule.minRatio, durationMin: exam.diagnostic.durationMin },
    sections: plan.sections.map((s) => {
      const tt = getTaskType(exam, s.taskType);
      return {
        skill: s.skill,
        taskType: s.taskType,
        answerType: tt.answerType,
        instruction: tt.instruction,
        ...(s.wordLimits ? { wordLimits: s.wordLimits } : {}),
        ...(s.maxAnswerSec ? { maxAnswerSec: s.maxAnswerSec } : {}),
        ...(tt.rubric ? { criteria: getRubric(exam, tt.rubric).criteria.map((c) => c.id) } : {}),
        items: s.itemIds.map((id) => publicItem(byId.get(id), { audioUrl: publicAudioUrl(byId.get(id).audio_path) })),
      };
    }),
  });
});

export const config = { path: '/api/attempt-start' };
