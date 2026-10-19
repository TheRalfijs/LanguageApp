import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  displayPercent, meetsMinimum, estimateStatus, skillResult, examResult,
  aggregateBySkill, scaleRubricScore,
} from '../shared/scoring.js';

const exam = JSON.parse(readFileSync(new URL('../config/exams/lv-b1.json', import.meta.url), 'utf8'));
const rule = exam.passRule;
const all = (points, max = 15) => ({
  listening: { points, max }, reading: { points, max }, writing: { points, max }, speaking: { points, max },
});

test('exactly 60% passes, just below fails', () => {
  assert.equal(meetsMinimum(9, 15, 0.6), true);
  assert.equal(meetsMinimum(18, 30, 0.6), true);
  assert.equal(meetsMinimum(3, 5, 0.6), true);
  assert.equal(meetsMinimum(21, 35, 0.6), true);
  assert.equal(meetsMinimum(8.99, 15, 0.6), false);
  assert.equal(meetsMinimum(8, 15, 0.6), false);
});

test('zero or missing max never passes', () => {
  assert.equal(meetsMinimum(0, 0, 0.6), false);
  assert.equal(displayPercent(5, 0), 0);
});

test('displayPercent rounds down so a fail never shows 60%', () => {
  assert.equal(displayPercent(59.9, 100), 59);
  assert.equal(displayPercent(9, 15), 60);
  assert.equal(displayPercent(2, 3), 66);
  assert.equal(displayPercent(20, 15), 100); // clamped
  assert.equal(displayPercent(-1, 15), 0);
});

test('all four skills at 60% → exam passed', () => {
  const r = examResult(all(9), exam);
  assert.equal(r.passed, true);
  assert.deepEqual(r.failedSkills, []);
});

test('a strong skill cannot compensate for a weak one', () => {
  const sp = all(15);
  sp.speaking = { points: 8, max: 15 }; // 53%
  const r = examResult(sp, exam);
  // total is 53/60 = 88%, still a fail
  assert.equal(r.passed, false);
  assert.deepEqual(r.failedSkills, ['speaking']);
  assert.equal(r.weakestSkill, 'speaking');
});

test('a skill that was not attempted means not passed', () => {
  const sp = all(15);
  delete sp.writing;
  const r = examResult(sp, exam);
  assert.equal(r.passed, false);
  assert.deepEqual(r.missing, ['writing']);
});

test('weakest skill: lowest ratio, ties broken by config order', () => {
  const sp = all(12);
  sp.reading = { points: 10, max: 15 };
  sp.writing = { points: 20, max: 30 }; // same ratio as reading
  assert.equal(examResult(sp, exam).weakestSkill, 'reading');
});

test('estimate status: likely pass / borderline / likely fail', () => {
  assert.equal(estimateStatus(0.7, rule), 'likely_pass');
  assert.equal(estimateStatus(0.95, rule), 'likely_pass');
  assert.equal(estimateStatus(0.6, rule), 'borderline');
  assert.equal(estimateStatus(0.5, rule), 'borderline');
  assert.equal(estimateStatus(0.49, rule), 'likely_fail');
  assert.equal(estimateStatus(0, rule), 'likely_fail');
});

test('skillResult uses pass/fail for real scores, estimate statuses for diagnostics', () => {
  assert.equal(skillResult(9, 15, rule).status, 'pass');
  assert.equal(skillResult(8, 15, rule).status, 'fail');
  assert.equal(skillResult(3, 4, rule, { estimate: true }).status, 'likely_pass');
  assert.equal(skillResult(2, 4, rule, { estimate: true }).status, 'borderline');
});

test('aggregateBySkill sums scores and maxima per skill', () => {
  const agg = aggregateBySkill([
    { skill: 'reading', score: 1, max: 1 },
    { skill: 'reading', score: 0, max: 1 },
    { skill: 'writing', score: 7, max: 12 },
    { skill: 'speaking', score: null, max: 15 }, // ungraded counts as 0
  ]);
  assert.deepEqual(agg, {
    reading: { points: 1, max: 2 },
    writing: { points: 7, max: 12 },
    speaking: { points: 0, max: 15 },
  });
});

test('scaleRubricScore maps raw rubric totals onto task maxPoints', () => {
  assert.equal(scaleRubricScore(6, 12, null), 6);
  assert.equal(scaleRubricScore(6, 12, 10), 5);
  assert.equal(scaleRubricScore(12, 12, 12), 12);
});
