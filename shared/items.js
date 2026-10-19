// Item content formats, per answerType (see config/exams/*.json → taskTypes).
//
// content_json   — what the item is. Safe parts are sent to the browser via
//                  publicItem(); hidden parts (listening scripts) never are.
// answer_key_json — correct answers. Never sent to the browser before answering.
//
// single_choice  content: { text?: { title?, body }, audio?: { segments: [{ voice, text }] },
//                           question, options: [string, …] }
//                answer:  { correct: <option index> }
// true_false     content: { text?|audio?, statement }        answer: { correct: true|false }
// free_text      content: { situation?, prompt, contentPoints: [string, …] }
// speech         content: { question, audio?: { segments } }  (audio = the question read aloud)

import { getTaskType } from './exam-config.js';

const isNonEmptyString = (s) => typeof s === 'string' && s.trim().length > 0;

function validateAudio(audio, errors) {
  if (!audio) return;
  if (!Array.isArray(audio.segments) || audio.segments.length === 0) errors.push('audio.segments must be a non-empty array');
  else if (!audio.segments.every((s) => isNonEmptyString(s.text))) errors.push('every audio segment needs text');
}

// → list of error strings (empty = valid)
export function validateItem(item, exam) {
  const errors = [];
  let tt;
  try {
    tt = getTaskType(exam, item.task_type);
  } catch (e) {
    return [e.message];
  }
  if (item.skill !== tt.skill) errors.push(`skill must be "${tt.skill}" for ${tt.id}`);
  const c = item.content_json || {};
  const key = item.answer_key_json || {};

  switch (tt.answerType) {
    case 'single_choice': {
      if (!isNonEmptyString(c.question)) errors.push('question is required');
      if (!Array.isArray(c.options) || c.options.length < 2 || !c.options.every(isNonEmptyString)) {
        errors.push('options must be at least 2 non-empty strings');
      } else {
        if (tt.optionsPerItem && c.options.length !== tt.optionsPerItem) errors.push(`exactly ${tt.optionsPerItem} options expected`);
        if (!(Number.isInteger(key.correct) && key.correct >= 0 && key.correct < c.options.length)) errors.push('answer_key_json.correct must be an option index');
        if (new Set(c.options.map((o) => o.trim().toLowerCase())).size !== c.options.length) errors.push('options must be different');
      }
      if (tt.skill === 'listening' && !c.audio) errors.push('listening items need audio');
      if (tt.skill === 'reading' && !isNonEmptyString(c.text?.body)) errors.push('reading items need text.body');
      validateAudio(c.audio, errors);
      break;
    }
    case 'true_false':
      if (!isNonEmptyString(c.statement)) errors.push('statement is required');
      if (typeof key.correct !== 'boolean') errors.push('answer_key_json.correct must be true/false');
      validateAudio(c.audio, errors);
      break;
    case 'free_text':
      if (!isNonEmptyString(c.prompt)) errors.push('prompt is required');
      if (!Array.isArray(c.contentPoints) || !c.contentPoints.every(isNonEmptyString)) errors.push('contentPoints must be strings');
      else if (tt.contentPoints && c.contentPoints.length !== tt.contentPoints) errors.push(`exactly ${tt.contentPoints} contentPoints expected`);
      break;
    case 'speech':
      if (!isNonEmptyString(c.question)) errors.push('question is required');
      validateAudio(c.audio, errors);
      break;
    default:
      errors.push(`answerType "${tt.answerType}" is not supported yet`);
  }
  return errors;
}

// The browser-safe view of an item: a whitelist, never a blacklist.
export function publicItem(item, { audioUrl = null } = {}) {
  const c = item.content_json || {};
  const base = { id: item.id, skill: item.skill, taskType: item.task_type };
  if (c.instruction) base.instruction = c.instruction;
  switch (item.skill) {
    case 'reading':
    case 'listening':
      return {
        ...base,
        ...(c.text ? { text: { title: c.text.title ?? null, body: c.text.body } } : {}),
        ...(c.audio ? { audioUrl } : {}),
        ...(c.question ? { question: c.question, options: [...c.options] } : {}),
        ...(c.statement ? { statement: c.statement } : {}),
      };
    case 'writing':
      return { ...base, situation: c.situation ?? null, prompt: c.prompt, contentPoints: [...c.contentPoints] };
    case 'speaking':
      return { ...base, question: c.question, audioUrl };
    default:
      return base;
  }
}

// Objective scoring. → { score, max, correct }
export function scoreObjective(item, answer, pointsPerItem = 1) {
  const key = item.answer_key_json || {};
  const chosen = answer?.choice;
  const correct = chosen !== undefined && chosen !== null && chosen === key.correct;
  return { score: correct ? pointsPerItem : 0, max: pointsPerItem, correct };
}

// Fisher–Yates on a copy; rng injectable for tests.
export function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
