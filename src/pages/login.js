import { ready } from '../main.js';
import { getUser, safeNext, claimAnonymousAttempts } from '../auth.js';
import { mountEmailLogin } from '../components/email-login.js';

const next = safeNext(new URLSearchParams(location.search).get('next'));

async function init() {
  await ready;
  if (await getUser()) {
    await claimAnonymousAttempts(); // e.g. arriving from a magic link after the free test
    location.replace(next);
    return;
  }
  const login = await mountEmailLogin(document.getElementById('login'), {
    next,
    onSuccess: () => location.replace(next),
  });
  // Supabase puts magic-link errors in the hash, e.g. #error_code=otp_expired
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('error_code') || hash.get('error')) {
    login?.showError('login.errors.linkExpired');
    history.replaceState(null, '', location.pathname + location.search);
  }
}

init();
