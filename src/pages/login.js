import { ready } from '../main.js';
import { t, onLocaleChange } from '../i18n.js';
import { isConfigured, getUser, sendMagicLink, verifyCode, safeNext } from '../auth.js';

const $ = (id) => document.getElementById(id);
const emailForm = $('email-form');
const codeForm = $('code-form');
const errorBox = $('login-error');
const next = safeNext(new URLSearchParams(location.search).get('next'));
const PENDING_KEY = 'login-pending-email';

let errorKey = null;
let pendingEmail = null;

function showError(key) {
  errorKey = key;
  errorBox.hidden = !key;
  errorBox.textContent = key ? t(key) : '';
}

function showCodeStep(email) {
  pendingEmail = email;
  emailForm.hidden = true;
  codeForm.hidden = false;
  $('sent-body').textContent = t('login.sentBody', { email });
  $('code').focus();
}

function showEmailStep() {
  pendingEmail = null;
  try { sessionStorage.removeItem(PENDING_KEY); } catch {}
  codeForm.hidden = true;
  emailForm.hidden = false;
  $('email').focus();
}

function errorKeyFor(error) {
  if (error?.status === 429 || /rate limit/i.test(error?.message || '')) return 'login.errors.tooMany';
  if (/expired|invalid/i.test(error?.message || '') || error?.code === 'otp_expired') return 'login.errors.badCode';
  return 'login.errors.generic';
}

// Text set from JS must follow language switches too.
onLocaleChange(() => {
  if (errorKey) showError(errorKey);
  if (pendingEmail) $('sent-body').textContent = t('login.sentBody', { email: pendingEmail });
});

async function init() {
  await ready;

  // Supabase puts link errors in the hash, e.g. #error_code=otp_expired
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('error_code') || hash.get('error')) {
    showError('login.errors.linkExpired');
    history.replaceState(null, '', location.pathname + location.search);
  }

  if (!isConfigured()) {
    showError('login.errors.notConfigured');
    emailForm.querySelector('button').disabled = true;
    return;
  }

  if (await getUser()) {
    location.replace(next);
    return;
  }

  try {
    const saved = sessionStorage.getItem(PENDING_KEY);
    if (saved) showCodeStep(saved);
  } catch {}
}

emailForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('email');
  const email = input.value.trim().toLowerCase();
  if (!input.checkValidity() || !email.includes('@')) {
    showError('login.errors.invalidEmail');
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  input.removeAttribute('aria-invalid');
  showError(null);

  const button = emailForm.querySelector('button');
  button.disabled = true;
  button.textContent = t('login.sending');
  const { error } = await sendMagicLink(email, next);
  button.disabled = false;
  button.textContent = t('login.send');

  if (error) {
    showError(errorKeyFor(error));
    return;
  }
  try { sessionStorage.setItem(PENDING_KEY, email); } catch {}
  showCodeStep(email);
});

codeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('code').value.replace(/\s/g, '');
  if (!/^\d{6,10}$/.test(code)) {
    showError('login.errors.badCode');
    return;
  }
  showError(null);
  const button = codeForm.querySelector('button[type=submit]');
  button.disabled = true;
  const { error } = await verifyCode(pendingEmail, code);
  button.disabled = false;
  if (error) {
    showError(errorKeyFor(error));
    return;
  }
  try { sessionStorage.removeItem(PENDING_KEY); } catch {}
  location.replace(next);
});

$('change-email').addEventListener('click', showEmailStep);

init();
