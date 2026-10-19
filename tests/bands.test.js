import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bandForScore, scoreRubric } from '../shared/scoring.js';
import { compareScript, calibrationSummary } from '../shared/calibration.js';

const exam = JSON.parse(readFileSync(new URL('../config/exams/lv-b1.json', import.meta.url), 'utf8'));
const app = JSON.parse(readFileSync(new URL('../config/app.json', import.meta.url), 'utf8'));
const writing = exam.rubrics.writing;

// A rubric with bands spanning several points, like many official scales.
const wide = {
  criteria: [{
    id: 'content', max: 8,
    bands: [
      { band: 0, min: 0, max: 1 }, { band: 1, min: 2, max: 3 },
      { band: 2, min: 4, max: 5 }, { band: 3, min: 6, max: 8 },
    ],
  }],
};

test('bandForScore maps scores to bands, including multi-point bands', () => {
  assert.equal(bandForScore(writing.criteria[0], 0), 0);
  assert.equal(bandForScore(writing.criteria[0], 3), 3);
  assert.equal(bandForScore(wide.criteria[0], 1), 0);
  assert.equal(bandForScore(wide.criteria[0], 4), 2);
  assert.equal(bandForScore(wide.criteria[0], 8), 3);
  assert.throws(() => bandForScore(wide.criteria[0], 9), RangeError);
  assert.throws(() => bandForScore(wide.criteria[0], -1), RangeError);
});

test('scoreRubric totals valid scores and attaches bands', () => {
  const r = scoreRubric(writing, [
    { id: 'task_completion', score: 3 }, { id: 'coherence', score: 2 },
    { id: 'vocabulary', score: 2 }, { id: 'grammar', score: 1 },
  ]);
  assert.equal(r.total, 8);
  assert.equal(r.maxTotal, 12);
  assert.deepEqual(r.criteria.map((c) => c.band), [3, 2, 2, 1]);
});

test('scoreRubric rejects missing, unknown, duplicate and out-of-range scores', () => {
  const ok = writing.criteria.map((c) => ({ id: c.id, score: 1 }));
  assert.throws(() => scoreRubric(writing, ok.slice(1)), /Missing/);
  assert.throws(() => scoreRubric(writing, [...ok, { id: 'style', score: 1 }]), /Unknown/);
  assert.throws(() => scoreRubric(writing, [...ok, ok[0]]), /Duplicate/);
  assert.throws(() => scoreRubric(writing, [{ ...ok[0], score: 4 }, ...ok.slice(1)]), RangeError);
  assert.throws(() => scoreRubric(writing, [{ ...ok[0], score: '2' }, ...ok.slice(1)]), /Missing/);
});

test('compareScript: within one band on every criterion = agreement', () => {
  const teacher = { task_completion: 3, coherence: 2, vocabulary: 2, grammar: 1 };
  const close = [
    { id: 'task_completion', score: 2 }, { id: 'coherence', score: 2 },
    { id: 'vocabulary', score: 3 }, { id: 'grammar', score: 0 },
  ];
  assert.equal(compareScript(writing, close, teacher).agreementOk, true);

  const off = { ...teacher, grammar: 3 }; // AI 0 vs teacher 3 → 3 bands apart
  const r = compareScript(writing, close, off);
  assert.equal(r.agreementOk, false);
  assert.equal(r.criteria.find((c) => c.id === 'grammar').bandDiff, -3);
});

test('compareScript: a missing criterion score is never agreement', () => {
  const r = compareScript(writing, { task_completion: 1 }, { task_completion: 1 });
  assert.equal(r.agreementOk, false);
});

test('calibration gate: needs ≥50 scripts AND ≥80% agreement', () => {
  const agree = { aiScores: { task_completion: 2, coherence: 2, vocabulary: 2, grammar: 2 },
    teacherScores: { task_completion: 2, coherence: 2, vocabulary: 3, grammar: 1 } };
  const disagree = { ...agree, teacherScores: { ...agree.teacherScores, grammar: 0, task_completion: 0 } };
  const s = app.calibration;

  const make = (a, d) => [...Array(a).fill(agree), ...Array(d).fill(disagree)];
  assert.equal(calibrationSummary(writing, make(40, 0), s).gateOpen, false); // 100% but only 40
  assert.equal(calibrationSummary(writing, make(40, 10), s).gateOpen, true); // 50, exactly 80%
  assert.equal(calibrationSummary(writing, make(39, 11), s).gateOpen, false); // 78%

  const sum = calibrationSummary(writing, make(40, 10), s);
  assert.equal(sum.n, 50);
  assert.equal(sum.agreeing, 40);
  const tc = sum.perCriterion.find((c) => c.id === 'task_completion');
  assert.equal(tc.meanDiff, (10 * 2) / 50); // AI +2 on the 10 disagreeing scripts
});
