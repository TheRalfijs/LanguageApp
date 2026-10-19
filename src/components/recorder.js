// Microphone recorder for spoken answers (MediaRecorder).
// Handles the permission flow and every failure we can detect, with a
// message the user can act on. Works in Chrome on Android (webm/opus) and
// Safari (mp4).
import { h } from '../dom.js';
import { t, onLocaleChange } from '../i18n.js';

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
const MIN_SEC = 3;

export function recordingSupport() {
  if (!window.isSecureContext) return 'insecure';
  if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === 'undefined') return 'unsupported';
  return 'ok';
}

export function pickMimeType() {
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
}

function errorKey(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError': return 'recorder.denied';
    case 'NotFoundError':
    case 'OverconstrainedError': return 'recorder.noMic';
    case 'NotReadableError':
    case 'AbortError': return 'recorder.busy';
    default: return 'recorder.failed';
  }
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * mountRecorder(container, { maxSec, onChange(recording|null) })
 * → { getRecording(), destroy() }   recording = { blob, mimeType, durationSec }
 */
export function mountRecorder(container, { maxSec = 60, onChange = () => {} } = {}) {
  let state = recordingSupport() === 'ok' ? 'idle' : recordingSupport();
  let messageKey = null;
  let recording = null;
  let mediaRecorder = null;
  let stream = null;
  let chunks = [];
  let startedAt = 0;
  let tick = null;
  let objectUrl = null;

  const timer = h('p', { class: 'recorder__timer', 'aria-live': 'off' });
  const status = h('p', { class: 'recorder__status', role: 'status', 'aria-live': 'polite' });
  const message = h('p', { class: 'alert alert--error', role: 'alert', hidden: true });
  const recordBtn = h('button', { type: 'button', class: 'btn btn--primary recorder__record', onclick: start });
  const stopBtn = h('button', { type: 'button', class: 'btn btn--primary recorder__stop', onclick: stop });
  const player = h('audio', { controls: true, preload: 'metadata', class: 'recorder__player', hidden: true });
  const root = h('div', { class: 'recorder' }, message, status, timer, recordBtn, stopBtn, player);
  container.replaceChildren(root);

  function render() {
    const elapsed = state === 'recording' ? (Date.now() - startedAt) / 1000 : recording?.durationSec ?? 0;
    root.dataset.state = state;
    timer.textContent = `${fmt(elapsed)} / ${fmt(maxSec)}`;
    timer.hidden = !['recording', 'recorded'].includes(state);
    recordBtn.hidden = !['idle', 'recorded', 'error'].includes(state);
    recordBtn.disabled = state === 'requesting';
    recordBtn.textContent = t(state === 'recorded' ? 'recorder.again' : 'recorder.start');
    stopBtn.hidden = state !== 'recording';
    stopBtn.textContent = t('recorder.stop');
    player.hidden = state !== 'recorded';
    const statusKey = { idle: 'recorder.ready', requesting: 'recorder.requesting', recording: 'recorder.recording', recorded: 'recorder.recorded' }[state];
    status.textContent = statusKey ? t(statusKey, { max: maxSec }) : '';
    const errKey = state === 'insecure' ? 'recorder.insecure' : state === 'unsupported' ? 'recorder.unsupported' : messageKey;
    message.hidden = !errKey;
    message.textContent = errKey ? t(errKey) : '';
  }

  async function start() {
    messageKey = null;
    state = 'requesting';
    render();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      state = 'error';
      messageKey = errorKey(err);
      render();
      return;
    }
    const mimeType = pickMimeType();
    try {
      mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      cleanupStream();
      state = 'error';
      messageKey = 'recorder.failed';
      render();
      return;
    }
    chunks = [];
    mediaRecorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mediaRecorder.onstop = finish;
    mediaRecorder.start(1000);
    startedAt = Date.now();
    state = 'recording';
    tick = setInterval(() => {
      if ((Date.now() - startedAt) / 1000 >= maxSec) stop();
      else render();
    }, 250);
    render();
  }

  function stop() {
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
  }

  function finish() {
    clearInterval(tick);
    const durationSec = Math.min(maxSec, (Date.now() - startedAt) / 1000);
    const type = (mediaRecorder.mimeType || chunks[0]?.type || 'audio/webm').split(';')[0];
    cleanupStream();
    if (durationSec < MIN_SEC || !chunks.length) {
      state = 'error';
      messageKey = 'recorder.tooShort';
      recording = null;
      onChange(null);
      render();
      return;
    }
    recording = { blob: new Blob(chunks, { type }), mimeType: type, durationSec };
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(recording.blob);
    player.src = objectUrl;
    state = 'recorded';
    onChange(recording);
    render();
  }

  function cleanupStream() {
    stream?.getTracks().forEach((tr) => tr.stop());
    stream = null;
  }

  const off = onLocaleChange(render);
  render();

  return {
    getRecording: () => recording,
    supported: () => recordingSupport() === 'ok',
    destroy() {
      off();
      clearInterval(tick);
      stop();
      cleanupStream();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
  };
}
