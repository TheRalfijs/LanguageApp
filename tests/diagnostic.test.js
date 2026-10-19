import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickDiagnosticItems, summarizeAttempt, responseState, sectionForItem } from '../shared/diagnostic.js';

const exam = JSON.parse(readFileSync(new URL('../config/exams/lv-b1.json', import.meta.url), 'utf8'));

const pool = (type, n, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: `${type}-${i}`, task_type: type, ...extra }));
const items = {
  reading_mcq: pool('reading_mcq', 6),
  listening_mcq: pool('listening_mcq', 6, { audio_path: 'a.mp3' }),
  writing_short: pool('writing_short', 3),
  speaking_monologue: pool('speaking_monologue', 3),
};

test('pick: right counts per section, word limits and answer time from config', () => {
  const plan = pickDiagnosticItems(exam, items, () => 0.5);
  const by = Object.fromEntries(plan.sections.map((s) => [s.skill, s]));
  assert.equal(by.reading.itemIds.length, 4);
  assert.equal(by.listening.itemIds.length, 4);
  assert.equal(by.writing.itemIds.length, 1);
  assert.deepEqual(by.writing.wordLimits, { min: 60, max: 80 });
  assert.equal(by.speaking.maxAnswerSec, 60);
  assert.equal(new Set(by.reading.itemIds).size, 4);
  assert.equal(sectionForItem(plan, by.writing.itemIds[0]).skill, 'writing');
});

test('pick: listening items without generated audio are never used', () => {
  const noAudio = { ...items, listening_mcq: [...pool('listening_mcq', 3, { audio_path: 'a' }), ...pool('x', 5).map((i) => ({ ...i, task_type: 'listening_mcq' }))] };
  assert.throws(() => pickDiagnosticItems(exam, noAudio), /Not enough approved items for listening_mcq/);
});

const plan = {
  sections: [
    { skill: 'reading', taskType: 'reading_mcq', itemIds: ['r1', 'r2', 'r3', 'r4'] },
    { skill: 'listening', taskType: 'listening_mcq', itemIds: ['l1', 'l2', 'l3', 'l4'] },
    { skill: 'writing', taskType: 'writing_short', itemIds: ['w1'] },
    { skill: 'speaking', taskType: 'speaking_monologue', itemIds: ['s1'] },
  ],
};
const done = (item_id, score, max_score = 1) => ({ item_id, score, max_score, grading_status: max_score === 1 ? 'not_needed' : 'graded' });
const NOW = Date.parse('2026-10-19T12:00:00Z');

test('summary: complete attempt → per-skill estimate with the 60% rule', () => {
  const responses = [
    done('r1', 1), done('r2', 1), done('r3', 1), done('r4', 0), // 75%
    done('l1', 1), done('l2', 1), done('l3', 0), done('l4', 0), // 50%
    done('w1', 9, 12), // 75%
    done('s1', 6, 15), // 40%
  ];
  const s = summarizeAttempt({ exam, attempt: { plan_json: plan, finished_at: 'x' }, responses, now: NOW });
  assert.equal(s.complete, true);
  assert.equal(s.result.passed, false);
  assert.equal(s.result.skills.reading.status, 'likely_pass');
  assert.equal(s.result.skills.listening.status, 'borderline');
  assert.equal(s.result.skills.speaking.status, 'likely_fail');
  assert.equal(s.result.weakestSkill, 'speaking');
});

test('summary: skipped objective items count as 0 once finished', () => {
  const s = summarizeAttempt({ exam, attempt: { plan_json: plan, finished_at: 'x' }, responses: [done('r1', 1)], now: NOW });
  assert.deepEqual(s.skillPoints.reading, { points: 1, max: 4 });
  assert.deepEqual(s.skillPoints.listening, { points: 0, max: 4 });
});

test('summary: no speaking answer (no microphone) → speaking missing, never passed', () => {
  const responses = ['r1', 'r2', 'r3', 'r4', 'l1', 'l2', 'l3', 'l4'].map((id) => done(id, 1)).concat(done('w1', 12, 12));
  const s = summarizeAttempt({ exam, attempt: { plan_json: plan, finished_at: 'x' }, responses, now: NOW });
  assert.deepEqual(s.result.missing, ['speaking']);
  assert.equal(s.result.passed, false);
});

test('summary: pending grading → not complete, no result yet', () => {
  const s = summarizeAttempt({
    exam, attempt: { plan_json: plan, finished_at: 'x' }, now: NOW,
    responses: [{ item_id: 'w1', grading_status: 'grading', grading_started_at: new Date(NOW - 60_000).toISOString(), max_score: 12 }],
  });
  assert.equal(s.complete, false);
  assert.equal(s.pendingCount, 1);
  assert.equal(s.result, null);
});

test('responseState: dead grading runs and never-uploaded audio count as failed', () => {
  assert.equal(responseState({ grading_status: 'grading', grading_started_at: new Date(NOW - 11 * 60_000).toISOString() }, NOW), 'failed');
  assert.equal(responseState({ grading_status: 'grading', grading_started_at: new Date(NOW - 60_000).toISOString() }, NOW), 'pending');
  assert.equal(responseState({ grading_status: 'awaiting_upload', created_at: new Date(NOW - 31 * 60_000).toISOString() }, NOW), 'failed');
  assert.equal(responseState({ grading_status: 'not_needed' }, NOW), 'done');
});
