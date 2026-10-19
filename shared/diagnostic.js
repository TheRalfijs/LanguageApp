// Pure logic for diagnostic (and later practice) attempts: which items an
// attempt gets, and how its responses turn into per-skill estimates.
import { getTaskType, itemMax } from './exam-config.js';
import { aggregateBySkill, examResult } from './scoring.js';
import { shuffle } from './items.js';

export const STALE_GRADING_MS = 10 * 60 * 1000; // a grading run older than this died
export const STALE_UPLOAD_MS = 30 * 60 * 1000; // audio never arrived

// itemsByTaskType: { [taskTypeId]: [item, …] } (approved items only).
// → plan stored in attempts.plan_json
export function pickDiagnosticItems(exam, itemsByTaskType, rng = Math.random) {
  return {
    sections: exam.diagnostic.sections.map((s) => {
      const tt = getTaskType(exam, s.taskType);
      const pool = (itemsByTaskType[s.taskType] || []).filter(
        (it) => !(tt.skill === 'listening' && !it.audio_path) // listening needs generated audio
      );
      if (pool.length < s.items) {
        throw new Error(`Not enough approved items for ${s.taskType}: need ${s.items}, have ${pool.length}`);
      }
      return {
        skill: s.skill,
        taskType: s.taskType,
        itemIds: shuffle(pool, rng).slice(0, s.items).map((it) => it.id),
        ...(s.wordLimits ? { wordLimits: s.wordLimits } : tt.wordLimits ? { wordLimits: tt.wordLimits } : {}),
        ...(s.maxAnswerSec ? { maxAnswerSec: s.maxAnswerSec } : tt.maxAnswerSec ? { maxAnswerSec: tt.maxAnswerSec } : {}),
      };
    }),
  };
}

export function sectionForItem(plan, itemId) {
  return plan.sections.find((s) => s.itemIds.includes(itemId)) ?? null;
}

export function maxForTaskType(exam, taskTypeId) {
  return itemMax(exam, getTaskType(exam, taskTypeId));
}

// Effective state of one response, accounting for runs that died.
export function responseState(r, now = Date.now()) {
  const age = (t) => now - new Date(t).getTime();
  if (r.grading_status === 'grading' && r.grading_started_at && age(r.grading_started_at) > STALE_GRADING_MS) return 'failed';
  if (r.grading_status === 'awaiting_upload' && age(r.created_at) > STALE_UPLOAD_MS) return 'failed';
  if (r.grading_status === 'graded' || r.grading_status === 'not_needed') return 'done';
  if (r.grading_status === 'failed') return 'failed';
  return 'pending'; // pending | grading | awaiting_upload
}

/**
 * attempt: { plan_json, finished_at }
 * responses: [{ item_id, score, max_score, grading_status, … }]
 * → { complete, pendingCount, failedCount, skillPoints, result }
 *
 * Skipped objective items count as 0 once the attempt is finished.
 * A skill with no gradable response (e.g. no microphone) is "missing" and
 * therefore not passed — never silently excluded from the rule.
 */
export function summarizeAttempt({ exam, attempt, responses, now = Date.now() }) {
  const plan = attempt.plan_json;
  const byItem = new Map(responses.map((r) => [r.item_id, r]));
  const entries = [];
  let pendingCount = 0;
  let failedCount = 0;

  for (const section of plan.sections) {
    const tt = getTaskType(exam, section.taskType);
    const objective = !tt.rubric;
    for (const itemId of section.itemIds) {
      const r = byItem.get(itemId);
      if (!r) {
        if (objective && attempt.finished_at) entries.push({ skill: section.skill, score: 0, max: maxForTaskType(exam, section.taskType) });
        continue;
      }
      const state = responseState(r, now);
      if (state === 'done') entries.push({ skill: section.skill, score: Number(r.score ?? 0), max: Number(r.max_score) });
      else if (state === 'pending') pendingCount += 1;
      else failedCount += 1;
    }
  }

  const complete = Boolean(attempt.finished_at) && pendingCount === 0;
  const skillPoints = aggregateBySkill(entries);
  return {
    complete,
    pendingCount,
    failedCount,
    skillPoints,
    result: complete ? examResult(skillPoints, exam, { estimate: true }) : null,
  };
}
