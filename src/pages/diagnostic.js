// Free diagnostic: reading → listening → writing → speaking, one screen per
// question. Answers are saved per section; writing and speaking are graded in
// a background function while the user continues.
import { ready } from '../main.js';
import { t, getLocale, onLocaleChange } from '../i18n.js';
import { api, ApiError } from '../api.js';
import { h, $ } from '../dom.js';
import { mountRecorder, recordingSupport } from '../components/recorder.js';
import { attachWordCounter } from '../components/word-counter.js';

const WRITING_SUGGESTED_MIN = 10;

let attempt = null;
let steps = [];
let pos = 0;
const choices = new Map();
let draftText = '';
let writingStartedAt = null;
let recorder = null;
let busy = false;

const stage = () => $('#diag-stage');

function errorMessage(err) {
  if (err instanceof ApiError) {
    if (err.code === 'rate_limited') return t('errors.rateLimited');
    if (err.code === 'network_error') return t('errors.network');
    if (err.code === 'service_not_configured') return t('errors.notConfigured');
  }
  return t('errors.generic');
}

function showStartError(err) {
  const box = $('#diag-error');
  box.textContent = errorMessage(err);
  box.hidden = false;
}

async function start() {
  const btn = $('#diag-start');
  btn.disabled = true;
  try {
    attempt = await api('attempt-start', { method: 'POST', body: { locale: getLocale() } });
  } catch (err) {
    btn.disabled = false;
    showStartError(err);
    return;
  }
  steps = attempt.sections.flatMap((section) =>
    section.items.map((item, i) => ({ section, item, index: i, count: section.items.length }))
  );
  $('#diag-intro').hidden = true;
  $('#diag-run').hidden = false;
  window.addEventListener('beforeunload', warnOnLeave);
  render();
}

function warnOnLeave(e) {
  e.preventDefault();
  e.returnValue = '';
}

function render() {
  recorder?.destroy();
  recorder = null;
  const step = steps[pos];
  $('#diag-step-label').textContent = t('diagnostic.progress', {
    skill: t(`skills.${step.section.skill}`), n: step.index + 1, total: step.count,
  });
  const progress = $('#diag-progress');
  progress.value = Math.round((pos / steps.length) * 100);
  progress.setAttribute('aria-label', t('diagnostic.progressLabel', { n: pos + 1, total: steps.length }));

  const view = { reading: renderChoice, listening: renderChoice, writing: renderWriting, speaking: renderSpeaking }[step.section.skill];
  stage().replaceChildren(view(step));
  stage().querySelector('h2')?.focus();
}

const instruction = (step) =>
  h('p', { class: 'task-instruction', lang: 'lv' }, step.item.instruction || step.section.instruction);

function actionBar(...buttons) {
  return h('div', { class: 'diag-actions' }, ...buttons);
}

function inlineError() {
  return h('p', { class: 'alert alert--error', role: 'alert', hidden: true });
}

// ---- Reading / listening ----------------------------------------------------

function renderChoice(step) {
  const { item } = step;
  const name = `q-${item.id}`;
  const chosen = choices.get(item.id);
  const nextBtn = h('button', { type: 'button', class: 'btn btn--primary', disabled: chosen === undefined, onclick: () => next(step) }, t('diagnostic.next'));

  const options = item.options.map((opt, i) =>
    h('label', { class: 'choice' },
      h('input', {
        type: 'radio', name, value: i, checked: chosen === i,
        onchange: () => { choices.set(item.id, i); nextBtn.disabled = false; },
      }),
      h('span', { lang: 'lv' }, opt)));

  return h('div', { class: 'diag-step stack' },
    h('h2', { tabindex: '-1', class: 'visually-hidden' }, t(`skills.${step.section.skill}`)),
    instruction(step),
    item.text ? h('article', { class: 'stimulus', lang: 'lv' },
      item.text.title ? h('h3', {}, item.text.title) : null,
      h('p', {}, item.text.body)) : null,
    step.section.skill === 'listening'
      ? h('div', { class: 'stimulus' },
        item.audioUrl
          ? h('audio', { controls: true, preload: 'auto', src: item.audioUrl, class: 'audio' })
          : h('p', { class: 'alert alert--error' }, t('diagnostic.audioMissing')),
        h('p', { class: 'muted' }, t('diagnostic.listenHint')))
      : null,
    h('fieldset', { class: 'choices' }, h('legend', { lang: 'lv' }, item.question), ...options),
    actionBar(
      h('button', { type: 'button', class: 'btn btn--link', onclick: () => { choices.delete(item.id); next(step); } }, t('diagnostic.skip')),
      nextBtn));
}

// ---- Writing ----------------------------------------------------------------

function renderWriting(step) {
  const { item, section } = step;
  writingStartedAt ??= Date.now();
  const limits = section.wordLimits;
  const error = inlineError();
  const counter = h('p', { class: 'word-counter', 'aria-live': 'polite', id: 'word-counter' });
  const timer = h('p', { class: 'muted' });
  const textarea = h('textarea', {
    id: 'writing-text', rows: '10', lang: 'lv', spellcheck: 'false', autocapitalize: 'sentences',
    autocomplete: 'off', 'aria-describedby': 'word-counter',
  });
  textarea.value = draftText;
  textarea.addEventListener('input', () => { draftText = textarea.value; });

  const tickTimer = () => {
    const left = WRITING_SUGGESTED_MIN * 60 - Math.floor((Date.now() - writingStartedAt) / 1000);
    timer.textContent = left > 0
      ? t('writing.timeLeft', { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` })
      : t('writing.timeUp');
  };
  tickTimer();
  const interval = setInterval(() => (document.contains(timer) ? tickTimer() : clearInterval(interval)), 1000);

  const submit = h('button', {
    type: 'button', class: 'btn btn--primary',
    onclick: async () => {
      const check = attachWordCounter(textarea, counter, limits);
      if (check.status === 'too_short' && !submit.dataset.confirmed) {
        submit.dataset.confirmed = '1';
        error.textContent = t('writing.tooShortConfirm', { min: limits.min });
        error.hidden = false;
        return;
      }
      await submitWriting(step, textarea.value, submit, error);
    },
  }, t('writing.submit'));

  const view = h('div', { class: 'diag-step stack' },
    h('h2', { tabindex: '-1' }, t('skills.writing')),
    instruction(step),
    h('div', { class: 'stimulus', lang: 'lv' },
      item.situation ? h('p', {}, item.situation) : null,
      h('p', { class: 'task-prompt' }, item.prompt),
      h('ul', {}, ...item.contentPoints.map((p) => h('li', {}, p)))),
    h('div', { class: 'field' },
      h('label', { for: 'writing-text' }, t('writing.label', { min: limits.min, max: limits.max })),
      textarea),
    counter,
    timer,
    error,
    actionBar(
      h('button', { type: 'button', class: 'btn btn--link', onclick: () => next(step) }, t('diagnostic.skip')),
      submit));
  attachWordCounter(textarea, counter, limits);
  return view;
}

async function submitWriting(step, text, button, error) {
  if (busy) return;
  busy = true;
  button.disabled = true;
  try {
    const { responseId } = await api('attempt-answer', { method: 'POST', body: { attemptId: attempt.attemptId, itemId: step.item.id, text } });
    await triggerGrading(responseId);
    busy = false;
    next(step);
  } catch (err) {
    busy = false;
    button.disabled = false;
    if (err instanceof ApiError && err.code === 'already_answered') return next(step);
    error.textContent = errorMessage(err);
    error.hidden = false;
  }
}

// ---- Speaking ---------------------------------------------------------------

function renderSpeaking(step) {
  const { item, section } = step;
  const error = inlineError();
  const recorderBox = h('div');
  const supported = recordingSupport() === 'ok';
  const submit = h('button', {
    type: 'button', class: 'btn btn--primary', disabled: true,
    onclick: () => submitSpeaking(step, submit, error),
  }, t('speaking.submit'));

  const questionText = h('p', { lang: 'lv', class: 'task-prompt', hidden: true }, item.question);
  const view = h('div', { class: 'diag-step stack' },
    h('h2', { tabindex: '-1' }, t('skills.speaking')),
    instruction(step),
    h('div', { class: 'stimulus' },
      item.audioUrl ? h('audio', { controls: true, preload: 'auto', src: item.audioUrl, class: 'audio' }) : null,
      h('button', {
        type: 'button', class: 'btn btn--link',
        onclick: (e) => { questionText.hidden = !questionText.hidden; e.target.setAttribute('aria-expanded', String(!questionText.hidden)); },
        'aria-expanded': item.audioUrl ? 'false' : 'true',
      }, t('speaking.showText')),
      questionText),
    h('p', {}, t('speaking.hint', { max: section.maxAnswerSec })),
    recorderBox,
    error,
    actionBar(
      h('button', { type: 'button', class: 'btn btn--link', onclick: () => next(step) }, t(supported ? 'diagnostic.skip' : 'speaking.skipNoMic')),
      submit));
  if (!item.audioUrl) questionText.hidden = false;

  recorder = mountRecorder(recorderBox, {
    maxSec: section.maxAnswerSec,
    onChange: (rec) => { submit.disabled = !rec; },
  });
  return view;
}

async function submitSpeaking(step, button, error) {
  const rec = recorder?.getRecording();
  if (!rec || busy) return;
  busy = true;
  button.disabled = true;
  button.textContent = t('speaking.uploading');
  try {
    const { responseId, uploadUrl } = await api('attempt-audio', {
      method: 'POST', body: { attemptId: attempt.attemptId, itemId: step.item.id, mimeType: rec.mimeType },
    });
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', rec.blob);
    const res = await fetch(uploadUrl, { method: 'PUT', body: form, headers: { 'x-upsert': 'true' } });
    if (!res.ok) throw new ApiError(res.status, 'upload_failed');
    await triggerGrading(responseId);
    busy = false;
    next(step);
  } catch (err) {
    busy = false;
    button.disabled = false;
    button.textContent = t('speaking.submit');
    error.textContent = err?.code === 'upload_failed' ? t('speaking.uploadFailed') : errorMessage(err);
    error.hidden = false;
  }
}

// ---- Flow ---------------------------------------------------------------------

function triggerGrading(responseId) {
  // Background function: answers 202 at once and grades for up to 15 min.
  return fetch('/.netlify/functions/grade-response-background', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ responseId }),
    keepalive: true,
  }).catch(() => {});
}

async function next(step) {
  if (busy) return;
  const lastOfSection = step.index === step.count - 1;
  if (lastOfSection && ['reading', 'listening'].includes(step.section.skill)) {
    busy = true;
    try {
      await api('attempt-answer', {
        method: 'POST',
        body: {
          attemptId: attempt.attemptId,
          answers: step.section.items.map((it) => ({ itemId: it.id, choice: choices.has(it.id) ? choices.get(it.id) : null })),
        },
      });
    } catch (err) {
      busy = false;
      const box = stage().querySelector('.alert') || stage().appendChild(inlineError());
      box.textContent = errorMessage(err);
      box.hidden = false;
      return;
    }
    busy = false;
  }
  if (pos < steps.length - 1) {
    pos += 1;
    render();
    window.scrollTo(0, 0);
  } else {
    await finish();
  }
}

async function finish() {
  stage().replaceChildren(h('p', { class: 'lead', role: 'status' }, t('diagnostic.finishing')));
  try {
    await api('attempt-finish', { method: 'POST', body: { attemptId: attempt.attemptId } });
  } catch {
    /* results page shows progress either way */
  }
  try { localStorage.setItem('last-attempt', attempt.attemptId); } catch {}
  window.removeEventListener('beforeunload', warnOnLeave);
  location.href = `/pages/results.html?attempt=${encodeURIComponent(attempt.attemptId)}`;
}

async function init() {
  await ready;
  $('#diag-start').addEventListener('click', start);
  onLocaleChange(() => {
    // Re-render the current step in the new language (answers are kept).
    // A recorded but unsent answer is kept: the recorder relabels itself.
    if (!attempt || !steps[pos] || busy || recorder?.getRecording()) return;
    render();
  });
}

init();
