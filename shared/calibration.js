// AI-vs-teacher agreement for the calibration tool. Paid AI grading for a
// rubric stays off until gateOpen() is true for it.

import { bandForScore } from './scoring.js';

// Accepts { task_completion: 2, … } or [{ id, score }, …] → Map(id → score).
export function toScoreMap(scores) {
  if (Array.isArray(scores)) return new Map(scores.map((c) => [c.id, c.score]));
  return new Map(Object.entries(scores || {}));
}

// Compare one script. Agreement = AI within maxBandDiff bands of the teacher
// on EVERY criterion of the rubric.
export function compareScript(rubric, aiScores, teacherScores, maxBandDiff = 1) {
  const ai = toScoreMap(aiScores);
  const teacher = toScoreMap(teacherScores);
  const criteria = rubric.criteria.map((c) => {
    const a = ai.get(c.id);
    const t = teacher.get(c.id);
    if (typeof a !== 'number' || typeof t !== 'number') {
      return { id: c.id, ai: a ?? null, teacher: t ?? null, diff: null, bandDiff: null, ok: false };
    }
    const bandDiff = bandForScore(c, a) - bandForScore(c, t);
    return { id: c.id, ai: a, teacher: t, diff: a - t, bandDiff, ok: Math.abs(bandDiff) <= maxBandDiff };
  });
  return { criteria, agreementOk: criteria.every((c) => c.ok) };
}

// Summary over many scripts [{ aiScores, teacherScores }].
export function calibrationSummary(rubric, scripts, settings) {
  const { minScripts, minAgreement, maxBandDiff } = settings;
  const results = scripts.map((s) => compareScript(rubric, s.aiScores, s.teacherScores, maxBandDiff));
  const n = results.length;
  const agreeing = results.filter((r) => r.agreementOk).length;
  const agreement = n ? agreeing / n : 0;

  const perCriterion = rubric.criteria.map((c) => {
    const rows = results.map((r) => r.criteria.find((x) => x.id === c.id)).filter((x) => x.diff !== null);
    const count = rows.length;
    return {
      id: c.id,
      count,
      meanDiff: count ? rows.reduce((s, x) => s + x.diff, 0) / count : null, // >0 = AI too generous
      meanAbsDiff: count ? rows.reduce((s, x) => s + Math.abs(x.diff), 0) / count : null,
      withinBandRate: count ? rows.filter((x) => x.ok).length / count : null,
    };
  });

  return {
    n,
    agreeing,
    agreement,
    perCriterion,
    gateOpen: n >= minScripts && agreement + 1e-9 >= minAgreement,
    results,
  };
}
