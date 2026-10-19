// Scoring rules shared by browser, functions and tests.
//
// THE rule: the exam is passed only if EVERY skill reaches passRule.minRatio
// (60%) of its own maximum. Totals across skills are never used for pass/fail.

import { getSkillIds } from './exam-config.js';

const EPS = 1e-9; // 9/15 must count as exactly 60%, despite floating point

export function ratio(points, max) {
  if (!(max > 0)) return 0;
  return Math.min(1, Math.max(0, points / max));
}

// Percent for display. Rounded DOWN, so 59.9% never shows as "60%".
export function displayPercent(points, max) {
  return Math.floor(ratio(points, max) * 100 + EPS);
}

export function meetsMinimum(points, max, minRatio) {
  return max > 0 && points / max + EPS >= minRatio;
}

// Status of a real (full exam) score: 'pass' | 'fail'.
// Status of an estimate (diagnostic, practice): 'likely_pass' | 'borderline' | 'likely_fail'.
export function estimateStatus(r, passRule) {
  const { likelyPassFrom, likelyFailBelow } = passRule.estimate;
  if (r + EPS >= likelyPassFrom) return 'likely_pass';
  if (r + EPS < likelyFailBelow) return 'likely_fail';
  return 'borderline';
}

export function skillResult(points, max, passRule, { estimate = false } = {}) {
  const r = ratio(points, max);
  const passed = meetsMinimum(points, max, passRule.minRatio);
  return {
    points,
    max,
    ratio: r,
    percent: displayPercent(points, max),
    passed,
    status: estimate ? estimateStatus(r, passRule) : passed ? 'pass' : 'fail',
  };
}

// Sum graded entries [{ skill, score, max }] into { [skill]: { points, max } }.
export function aggregateBySkill(entries) {
  const out = {};
  for (const { skill, score, max } of entries) {
    out[skill] ??= { points: 0, max: 0 };
    out[skill].points += score ?? 0;
    out[skill].max += max;
  }
  return out;
}

// Whole-exam result from { [skill]: { points, max } }.
// A skill that is missing (not attempted) counts as not passed.
export function examResult(skillPoints, exam, { estimate = false } = {}) {
  const skills = {};
  const missing = [];
  for (const id of getSkillIds(exam)) {
    const sp = skillPoints[id];
    if (!sp || !(sp.max > 0)) {
      missing.push(id);
      continue;
    }
    skills[id] = skillResult(sp.points, sp.max, exam.passRule, { estimate });
  }
  const scored = Object.entries(skills);
  const passed = missing.length === 0 && scored.every(([, s]) => s.passed);
  return {
    passed,
    skills,
    missing,
    failedSkills: scored.filter(([, s]) => !s.passed).map(([id]) => id),
    weakestSkill: weakestSkill(skills, getSkillIds(exam)),
  };
}

// Lowest ratio wins; ties go to the skill listed first in the config.
export function weakestSkill(skills, order) {
  let best = null;
  for (const id of order) {
    const s = skills[id];
    if (s && (best === null || s.ratio < skills[best].ratio - EPS)) best = id;
  }
  return best;
}

// ---- Rubric scoring (writing, speaking) -----------------------------------

export function bandForScore(criterion, score) {
  const b = criterion.bands.find((x) => score >= x.min && score <= x.max);
  if (!b) throw new RangeError(`Score ${score} outside bands of criterion "${criterion.id}"`);
  return b.band;
}

// Validate and total per-criterion scores [{ id, score }] against a rubric.
// Every criterion must be present exactly once and within 0..max.
export function scoreRubric(rubric, criteriaScores) {
  const byId = new Map();
  for (const c of criteriaScores) {
    if (byId.has(c.id)) throw new Error(`Duplicate criterion "${c.id}"`);
    byId.set(c.id, c.score);
  }
  const criteria = rubric.criteria.map((def) => {
    const score = byId.get(def.id);
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      throw new Error(`Missing score for criterion "${def.id}"`);
    }
    if (score < 0 || score > def.max) {
      throw new RangeError(`Criterion "${def.id}" score ${score} not in 0..${def.max}`);
    }
    byId.delete(def.id);
    return { id: def.id, score, max: def.max, band: bandForScore(def, score) };
  });
  if (byId.size) throw new Error(`Unknown criteria: ${[...byId.keys()].join(', ')}`);
  return {
    criteria,
    total: criteria.reduce((s, c) => s + c.score, 0),
    maxTotal: criteria.reduce((s, c) => s + c.max, 0),
  };
}

// Scale a raw rubric total onto a task's configured maxPoints (if any).
export function scaleRubricScore(total, maxTotal, taskMaxPoints) {
  if (taskMaxPoints == null || taskMaxPoints === maxTotal) return total;
  return (total / maxTotal) * taskMaxPoints;
}
