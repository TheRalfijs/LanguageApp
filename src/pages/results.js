// Results of a diagnostic: per-skill estimate against the 60% line, then
// full feedback for the logged-in owner (anonymous visitors get an email gate).
import { ready } from '../main.js';
import { t, onLocaleChange } from '../i18n.js';
import { api, ApiError } from '../api.js';
import { h, $, append } from '../dom.js';
import { renderSkillBars } from '../components/skill-bars.js';
import { renderHighlightedText } from '../components/error-highlight.js';
import { hasStoredSession } from '../auth-hint.js';

const SKILL_ORDER = ['listening', 'reading', 'writing', 'speaking'];
const POLL_MS = 3000;
const MAX_POLLS = 80;
const STATUS_RANK = { not_attempted: 0, likely_fail: 1, fail: 1, borderline: 2, likely_pass: 3, pass: 3 };

const attemptId = new URLSearchParams(location.search).get('attempt') || safeLocal('last-attempt');
let status = null;
let polls = 0;
let pollTimer = null;
let triedClaim = false;
let gateMounted = false;

function safeLocal(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function showError(key) {
  const box = $('#results-error');
  box.textContent = key ? t(key) : '';
  box.hidden = !key;
}

async function load() {
  try {
    status = await api(`attempt-status?id=${encodeURIComponent(attemptId)}`);
    // Logged in, but the attempt still belongs to this browser: link it first.
    if (status.feedbackLocked && hasStoredSession() && !triedClaim) {
      triedClaim = true;
      const { claimAnonymousAttempts } = await import('../auth.js');
      await claimAnonymousAttempts();
      status = await api(`attempt-status?id=${encodeURIComponent(attemptId)}`);
    }
    showError(null);
  } catch (err) {
    showError(err instanceof ApiError && err.status === 404 ? 'results.notFound' : 'errors.generic');
    return;
  }
  render();
  clearTimeout(pollTimer);
  if (!status.complete && status.finished && polls < MAX_POLLS) {
    polls += 1;
    pollTimer = setTimeout(load, POLL_MS);
  }
}

function render() {
  if (!status) return;
  const progress = $('#results-progress');
  progress.hidden = status.complete;
  if (!status.complete) {
    progress.replaceChildren(h('p', { class: 'lead' },
      !status.finished ? t('results.notFinished') : polls >= MAX_POLLS ? t('results.slow') : t('results.grading')));
    if (!status.finished) progress.append(h('p', {}, h('a', { href: '/pages/diagnostic.html' }, t('results.restart'))));
  }

  renderFailed();

  const summary = $('#results-summary');
  summary.hidden = !status.result;
  if (status.result) {
    renderSkillBars($('#skill-bars'), status.result, { order: SKILL_ORDER });
    $('#results-verdict').textContent = verdict(status.result);
  }

  const gate = $('#results-gate');
  gate.hidden = !(status.complete && status.feedbackLocked);
  if (!gate.hidden && !gateMounted) {
    gateMounted = true;
    import('../components/email-login.js').then(({ mountEmailLogin }) =>
      mountEmailLogin($('#results-login'), {
        next: location.pathname + location.search,
        introKey: 'results.gateIntro',
        onSuccess: () => { triedClaim = true; load(); },
      }));
  }

  const fb = $('#results-feedback');
  fb.hidden = !status.feedback;
  if (status.feedback) renderFeedback(fb, status.feedback);

  $('#results-next').hidden = !status.complete;
}

function verdict(result) {
  const statuses = SKILL_ORDER.map((id) => result.skills[id]?.status ?? 'not_attempted');
  const worst = statuses.reduce((a, b) => (STATUS_RANK[b] < STATUS_RANK[a] ? b : a));
  const weakest = t(`skills.${result.weakestSkill ?? result.missing?.[0] ?? 'speaking'}`);
  if (result.missing?.length) return t('results.verdictMissing', { skills: result.missing.map((s) => t(`skills.${s}`)).join(', ') });
  if (worst === 'likely_pass') return t('results.verdictPass');
  if (worst === 'borderline') return t('results.verdictBorderline', { skill: weakest });
  return t('results.verdictFail', { skill: weakest });
}

function renderFailed() {
  const box = $('#results-failed');
  box.replaceChildren(...(status.failed || []).map((f) =>
    h('div', { class: 'alert alert--error' },
      h('p', {}, t('results.gradingFailed', { skill: t(`skills.${f.skill}`) })),
      f.retryable
        ? h('button', {
          type: 'button', class: 'btn btn--secondary',
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              await api('attempt-answer', { method: 'POST', body: { attemptId, retry: f.responseId } });
              await fetch('/.netlify/functions/grade-response-background', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ responseId: f.responseId }),
              });
              polls = 0;
              load();
            } catch (err) {
              e.target.disabled = false;
              showError(err?.code === 'rate_limited' ? 'errors.rateLimited' : 'errors.generic');
            }
          },
        }, t('results.retry'))
        : h('p', { class: 'muted' }, t('results.audioMissing')))));
}

// ---- Full feedback ------------------------------------------------------------

function renderFeedback(container, sections) {
  container.replaceChildren(
    h('h2', {}, t('feedback.title')),
    ...sections.map((s) => h('section', { class: 'feedback-section' },
      h('h3', {}, t(`skills.${s.skill}`)),
      ...s.items.map((item) => (s.skill === 'writing' ? writingFeedback(item)
        : s.skill === 'speaking' ? speakingFeedback(item) : choiceFeedback(item, s.skill))))));
}

function choiceFeedback(item, skill) {
  const answer = item.chosen === null ? t('feedback.noAnswer') : item.options[item.chosen];
  return h('div', { class: `card feedback-item ${item.isCorrect ? 'is-correct' : 'is-wrong'}` },
    h('p', { class: 'feedback-item__q', lang: 'lv' }, item.question),
    h('p', {}, h('span', { class: 'feedback-mark', 'aria-hidden': 'true' }, item.isCorrect ? '✓ ' : '✗ '),
      t('feedback.yourAnswer'), ' ', h('span', { lang: 'lv' }, answer)),
    item.isCorrect ? null : h('p', {}, t('feedback.correctAnswer'), ' ', h('strong', { lang: 'lv' }, item.options[item.correctIndex])),
    skill === 'reading' && item.text
      ? h('details', {}, h('summary', {}, t('feedback.showText')), h('p', { lang: 'lv' }, item.text.body))
      : null,
    item.script
      ? h('details', {}, h('summary', {}, t('feedback.showScript')), h('p', { lang: 'lv', class: 'pre-line' }, item.script))
      : null);
}

function criteriaList(criteria, rubric) {
  return h('ul', { class: 'criteria' }, ...criteria.map((c) =>
    h('li', { class: 'criterion' },
      h('p', { class: 'criterion__head' },
        h('span', {}, t(`criteria.${c.id}`)),
        c.approximate ? h('span', { class: 'badge badge--muted' }, t('feedback.approximate')) : null,
        h('span', { class: 'criterion__score' }, `${c.score} / ${c.max}`)),
      c.comment ? h('p', { class: 'muted' }, c.comment) : null)));
}

function gradingState(item) {
  if (item.status === 'failed') return h('p', {}, t('results.gradingFailedShort'));
  if (item.status === 'missing') return h('p', { class: 'muted' }, t('feedback.notAnswered'));
  return h('p', { class: 'muted' }, t('results.grading'));
}

function writingFeedback(item) {
  const o = item.output;
  const box = h('div', { class: 'card stack feedback-item' },
    h('p', { lang: 'lv', class: 'task-prompt' }, item.prompt));
  if (!o) {
    box.append(gradingState(item));
    return box;
  }
  const textBox = h('div');
  renderHighlightedText(textBox, item.text, o.errors);
  append(box,
    h('p', { class: 'feedback-total' }, t('feedback.total', { score: o.total, max: o.max_total })),
    o.overall_comment ? h('p', {}, o.overall_comment) : null,
    h('p', { class: 'muted' }, t('writing.wordCount', { count: o.word_check.count, min: o.word_check.min, max: o.word_check.max }),
      o.word_check.status !== 'ok' ? ` — ${t(`writing.${o.word_check.status}`)}` : ''),
    criteriaList(o.criteria),
    h('h4', {}, t('feedback.contentPoints')),
    h('ul', { class: 'checklist checklist--status' }, ...o.content_points.map((p) =>
      h('li', { class: p.covered ? 'is-covered' : 'is-missing' },
        h('span', { class: 'visually-hidden' }, t(p.covered ? 'feedback.covered' : 'feedback.notCovered')),
        h('span', { lang: 'lv' }, p.text)))),
    h('h4', {}, t('feedback.yourText')),
    o.errors.length ? h('p', { class: 'muted' }, t('feedback.tapHint')) : null,
    textBox,
    o.unlocated_errors?.length
      ? h('ul', { class: 'error-list' }, ...o.unlocated_errors.map((e) =>
        h('li', {}, h('del', { lang: 'lv' }, e.original), ' → ', h('ins', { lang: 'lv' }, e.correction), ` — ${e.explanation}`)))
      : null,
    o.rewrite_suggestion
      ? h('details', {}, h('summary', {}, t('feedback.rewrite')), h('p', { lang: 'lv', class: 'pre-line' }, o.rewrite_suggestion))
      : null);
  return box;
}

function speakingFeedback(item) {
  const o = item.output;
  const box = h('div', { class: 'card stack feedback-item' }, h('p', { lang: 'lv', class: 'task-prompt' }, item.question));
  if (!o) {
    box.append(gradingState(item));
    return box;
  }
  const transcriptBox = h('div');
  if (item.transcript) renderHighlightedText(transcriptBox, item.transcript, o.errors);
  else transcriptBox.append(h('p', { class: 'muted' }, t('feedback.noSpeech')));
  append(box,
    h('p', { class: 'feedback-total' }, t('feedback.total', { score: o.total, max: o.max_total })),
    o.overall_comment ? h('p', {}, o.overall_comment) : null,
    criteriaList(o.criteria),
    h('h4', {}, t('feedback.transcript')),
    h('p', { class: 'muted' }, t('feedback.transcriptNote')),
    transcriptBox,
    o.improved_answer
      ? h('details', {}, h('summary', {}, t('feedback.improvedAnswer')), h('p', { lang: 'lv', class: 'pre-line' }, o.improved_answer))
      : null);
  return box;
}

async function init() {
  await ready;
  if (!attemptId) {
    showError('results.notFound');
    $('#results-progress').hidden = true;
    return;
  }
  onLocaleChange(render);
  load();
}

init();
