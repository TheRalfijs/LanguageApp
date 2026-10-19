// Auth helpers: magic link + one-time code, header state, locale ↔ profile sync.
import { supabase } from './supabase.js';
import { getLocale, setLocale, onLocaleChange, applyTranslations, ENABLED_LOCALES } from './i18n.js';

let currentUser = null;
let profileLocale = null;

export function isConfigured() {
  return Boolean(supabase);
}

export async function getUser() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

export async function getAccessToken() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

// Only same-site relative paths, never "//evil.com".
export function safeNext(next, fallback = '/pages/account.html') {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}

export async function sendMagicLink(email, next) {
  const redirect = new URL('/pages/login.html', location.origin);
  if (next) redirect.searchParams.set('next', safeNext(next));
  return supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirect.toString(),
      shouldCreateUser: true,
      data: { locale: getLocale() }, // becomes profiles.locale for new users
    },
  });
}

export async function verifyCode(email, token) {
  return supabase.auth.verifyOtp({ email, token, type: 'email' });
}

export async function signOut() {
  await supabase?.auth.signOut();
  location.href = '/';
}

function updateHeader(user) {
  const link = document.getElementById('auth-link');
  if (!link) return;
  link.href = user ? '/pages/account.html' : '/pages/login.html';
  link.dataset.i18n = user ? 'nav.account' : 'nav.login';
  applyTranslations(link.parentElement);
}

// The profile's locale is the user's remembered choice; apply it on login.
async function syncLocaleFromProfile(user) {
  const { data } = await supabase.from('profiles').select('locale').eq('id', user.id).maybeSingle();
  profileLocale = data?.locale ?? null;
  if (profileLocale && profileLocale !== getLocale() && ENABLED_LOCALES.includes(profileLocale)) {
    await setLocale(profileLocale);
  }
}

async function saveLocaleToProfile(code) {
  if (!currentUser || code === profileLocale) return;
  const { error } = await supabase.from('profiles').update({ locale: code }).eq('id', currentUser.id);
  if (!error) profileLocale = code;
}

export async function initAuth() {
  if (!supabase) return null;
  onLocaleChange(saveLocaleToProfile);
  supabase.auth.onAuthStateChange((event, session) => {
    const user = session?.user ?? null;
    const changed = user?.id !== currentUser?.id;
    currentUser = user;
    updateHeader(user);
    // Defer: Supabase docs advise against awaiting other calls inside this callback.
    if (user && changed) setTimeout(() => syncLocaleFromProfile(user), 0);
  });
  currentUser = await getUser();
  updateHeader(currentUser);
  return currentUser;
}
