import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateItem, publicItem, scoreObjective, shuffle } from '../shared/items.js';
import { countWords, wordCheck, tooShortToGrade, locateErrors } from '../shared/writing.js';

const exam = JSON.parse(readFileSync(new URL('../config/exams/lv-b1.json', import.meta.url), 'utf8'));
const seed = JSON.parse(readFileSync(new URL('../content/items/lv-b1/seed.json', import.meta.url), 'utf8'));

test('every seed item is valid, and there are enough for the diagnostic', () => {
  for (const it of seed.items) assert.deepEqual(validateItem(it, exam), [], it.seed_id);
  for (const s of exam.diagnostic.sections) {
    const n = seed.items.filter((it) => it.task_type === s.taskType).length;
    assert.ok(n >= s.items, `${s.taskType}: ${n} < ${s.items}`);
  }
});

test('seed answer keys are spread over options (not always the same index)', () => {
  const keys = seed.items.filter((it) => it.answer_key_json).map((it) => it.answer_key_json.correct);
  assert.ok(new Set(keys).size >= 3);
});

test('validateItem catches broken items', () => {
  const bad = { skill: 'reading', task_type: 'reading_mcq', content_json: { question: 'Q', options: ['a', 'a', 'b'], text: { body: 'x' } }, answer_key_json: { correct: 5 } };
  const errors = validateItem(bad, exam);
  assert.ok(errors.some((e) => e.includes('correct')));
  assert.ok(errors.some((e) => e.includes('different')));
  assert.ok(validateItem({ ...bad, task_type: 'nope' }, exam)[0].includes('Unknown task type'));
});

test('publicItem never leaks answer keys or listening scripts', () => {
  for (const it of seed.items) {
    const pub = JSON.stringify(publicItem({ id: 'x', ...it }, { audioUrl: 'https://a/b.mp3' }));
    assert.doesNotMatch(pub, /answer_key|"correct"/);
    if (it.skill === 'listening') {
      for (const seg of it.content_json.audio.segments) assert.ok(!pub.includes(seg.text), `${it.seed_id} leaks its script`);
      assert.match(pub, /audioUrl/);
    }
  }
});

test('scoreObjective', () => {
  const item = { answer_key_json: { correct: 2 } };
  assert.deepEqual(scoreObjective(item, { choice: 2 }), { score: 1, max: 1, correct: true });
  assert.deepEqual(scoreObjective(item, { choice: 1 }), { score: 0, max: 1, correct: false });
  assert.deepEqual(scoreObjective(item, { choice: null }), { score: 0, max: 1, correct: false });
  assert.equal(scoreObjective({ answer_key_json: { correct: 0 } }, { choice: 0 }, 2).score, 2);
});

test('shuffle keeps all elements and does not mutate', () => {
  const a = [1, 2, 3, 4, 5];
  const s = shuffle(a, () => 0.3);
  assert.deepEqual([...s].sort(), a);
  assert.deepEqual(a, [1, 2, 3, 4, 5]);
});

test('countWords handles Latvian letters, hyphens, numbers and punctuation', () => {
  assert.equal(countWords('Sveiki, Andri! Kā tev iet?'), 5);
  assert.equal(countWords('pārdevējs-kasieris strādā no 10.30 līdz 18.00'), 6);
  assert.equal(countWords('  '), 0);
  assert.equal(countWords('— , . !'), 0);
  assert.equal(countWords("Ģimenes ārsts, žurnāls, čūska"), 4);
});

test('wordCheck and the too-short guard', () => {
  const limits = { min: 60, max: 80 };
  assert.equal(wordCheck('vārds '.repeat(59), limits).status, 'too_short');
  assert.equal(wordCheck('vārds '.repeat(60), limits).status, 'ok');
  assert.equal(wordCheck('vārds '.repeat(81), limits).status, 'too_long');
  assert.equal(tooShortToGrade(9, limits), true);
  assert.equal(tooShortToGrade(15, limits), false);
});

test('locateErrors finds spans in order, never overlapping, and reports misses', () => {
  const text = 'Es iet uz veikals. Es iet mājās.';
  const { located, unlocated } = locateErrors(text, [
    { original: 'Es iet', correction: 'Es eju' },
    { original: 'veikals', correction: 'veikalu' },
    { original: 'Es iet', correction: 'Es eju' },
    { original: 'nav tekstā', correction: 'x' },
  ]);
  assert.deepEqual(located.map((e) => [e.start, e.end]), [[0, 6], [10, 17], [19, 25]]);
  assert.equal(unlocated.length, 1);
  for (const e of located) assert.equal(text.slice(e.start, e.end), e.original);
});
