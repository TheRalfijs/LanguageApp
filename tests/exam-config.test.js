import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { validateExamConfig, skillMax, itemMax, getTaskType, placeholderPaths } from '../shared/exam-config.js';

const dir = new URL('../config/exams/', import.meta.url);
const load = (f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const lvb1 = load('lv-b1.json');

test('every exam config in config/exams/ is valid', () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const exam = load(file);
    assert.deepEqual(validateExamConfig(exam), [], file);
    assert.equal(`${exam.code}.json`, file, 'file name must match code');
  }
});

test('lv-b1 has the four skills and a 60% per-skill rule', () => {
  assert.deepEqual(lvb1.skills.map((s) => s.id), ['listening', 'reading', 'writing', 'speaking']);
  assert.equal(lvb1.passRule.minRatio, 0.6);
});

test('diagnostic writing task is 60–80 words, speaking answer 60 s', () => {
  const s = Object.fromEntries(lvb1.diagnostic.sections.map((x) => [x.skill, x]));
  assert.deepEqual(s.writing.wordLimits, { min: 60, max: 80 });
  assert.equal(s.speaking.maxAnswerSec, 60);
  assert.equal(s.reading.items, 4);
  assert.equal(s.listening.items, 4);
});

test('skill maxima are derived from task types and rubrics', () => {
  assert.equal(itemMax(lvb1, getTaskType(lvb1, 'writing_short')), 12);
  assert.ok(skillMax(lvb1, 'reading') > 0);
  assert.equal(skillMax(lvb1, 'writing'), 24);
});

test('validator catches broken configs', () => {
  const broken = structuredClone(lvb1);
  broken.passRule.minRatio = 1.5;
  broken.taskTypes[0].skill = 'singing';
  broken.rubrics.writing.criteria[0].bands[1].min = 2; // gap
  const errors = validateExamConfig(broken);
  assert.ok(errors.some((e) => e.includes('minRatio')));
  assert.ok(errors.some((e) => e.includes('unknown skill "singing"')));
  assert.ok(errors.some((e) => e.includes('should start at 1')));
});

test('placeholderPaths lists every placeholder (lv-b1 is still placeholder until the VIAA PDF is in)', () => {
  const paths = placeholderPaths(lvb1);
  assert.ok(paths.includes('(root)'));
  assert.ok(paths.includes('rubrics.writing'));
});
