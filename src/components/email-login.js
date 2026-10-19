// Two-step email login (magic link + one-time code), used by the login page
// and the results page's email gate. Loads supabase-js only when mounted.
import { h } from '../dom.js';
import { t, onLocaleChange } from '../i18n.js';

const PENDING_KEY = 'login-pending-email';

function errorKeyFor(error) {
  if (error?.status === 429 || /rate limit/i.test(error?.message || '')) return 'login.errors.tooMany';
  if (error?.code === 'otp_expired' || /expired|invalid/i.test(error?.message || '')) return 'login.errors.badCode';
  return 'login.errors.generic';
}

/**
 * mountEmailLogin(container, { next, intro, onSuccess })
 * next: path the magic link returns to; onSuccess: called after code login.
 */
export async function mountEmailLogin(container, { next, introKey = 'login.intro', onSuccess } = {}) {
  const auth = await import('../auth.js');
  let errorKey = null;
  let pendingEmail = null;

  const errorBox = h('p', { class: 'alert alert--error', role: 'alert', hidden: true });
  const emailInput = h('input', { id: 'login-email', type: 'email', inputmode: 'email', autocomplete: 'email', required: true });
  const sendBtn = h('button', { class: 'btn btn--primary', type: 'submit' });
  const intro = h('p');
  const emailForm = h('form', { class: 'stack', novalidate: true },
    intro,
    h('div', { class: 'field' }, h('label', { for: 'login-email', 'data-i18n': 'login.emailLabel' }, t('login.emailLabel')), emailInput),
    sendBtn);

  const sentBody = h('p', { 'aria-live': 'polite' });
  const codeInput = h('input', { id: 'login-code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]*', maxlength: '10', required: true });
  const verifyBtn = h('button', { class: 'btn btn--primary', type: 'submit', 'data-i18n': 'login.verify' }, t('login.verify'));
  const changeBtn = h('button', { class: 'btn btn--link', type: 'button', 'data-i18n': 'login.changeEmail' }, t('login.changeEmail'));
  const codeForm = h('form', { class: 'stack', novalidate: true, hidden: true },
    h('h2', { 'data-i18n': 'login.sentTitle' }, t('login.sentTitle')),
    sentBody,
    h('div', { class: 'field' }, h('label', { for: 'login-code', 'data-i18n': 'login.codeLabel' }, t('login.codeLabel')), codeInput),
    verifyBtn,
    h('p', { class: 'muted', 'data-i18n': 'login.spamHint' }, t('login.spamHint')),
    changeBtn);

  container.replaceChildren(errorBox, emailForm, codeForm);

  const render = () => {
    intro.textContent = t(introKey);
    sendBtn.textContent = t(sendBtn.disabled ? 'login.sending' : 'login.send');
    errorBox.hidden = !errorKey;
    errorBox.textContent = errorKey ? t(errorKey) : '';
    if (pendingEmail) sentBody.textContent = t('login.sentBody', { email: pendingEmail });
  };
  const showError = (key) => { errorKey = key; render(); };
  onLocaleChange(render);

  const showCodeStep = (email) => {
    pendingEmail = email;
    emailForm.hidden = true;
    codeForm.hidden = false;
    render();
    codeInput.focus();
  };

  if (!auth.isConfigured()) {
    showError('login.errors.notConfigured');
    sendBtn.disabled = true;
    return;
  }

  emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim().toLowerCase();
    if (!emailInput.checkValidity() || !email.includes('@')) {
      emailInput.setAttribute('aria-invalid', 'true');
      showError('login.errors.invalidEmail');
      emailInput.focus();
      return;
    }
    emailInput.removeAttribute('aria-invalid');
    errorKey = null;
    sendBtn.disabled = true;
    render();
    const { error } = await auth.sendMagicLink(email, next);
    sendBtn.disabled = false;
    render();
    if (error) return showError(errorKeyFor(error));
    try { sessionStorage.setItem(PENDING_KEY, email); } catch {}
    showCodeStep(email);
  });

  codeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = codeInput.value.replace(/\s/g, '');
    if (!/^\d{6,10}$/.test(code)) return showError('login.errors.badCode');
    errorKey = null;
    verifyBtn.disabled = true;
    const { error } = await auth.verifyCode(pendingEmail, code);
    verifyBtn.disabled = false;
    if (error) return showError(errorKeyFor(error));
    try { sessionStorage.removeItem(PENDING_KEY); } catch {}
    await auth.claimAnonymousAttempts();
    onSuccess?.();
  });

  changeBtn.addEventListener('click', () => {
    pendingEmail = null;
    try { sessionStorage.removeItem(PENDING_KEY); } catch {}
    codeForm.hidden = true;
    emailForm.hidden = false;
    emailInput.focus();
  });

  try {
    const saved = sessionStorage.getItem(PENDING_KEY);
    if (saved) showCodeStep(saved);
  } catch {}
  render();

  return { showError };
}
