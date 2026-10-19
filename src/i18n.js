// Browser i18n: loads /locales/*.json on demand, translates the DOM and
// remembers the choice. Latvian text is written inline in the HTML, so pages
// render correctly before (or without) this script.
//
// Markup:
//   <h1 data-i18n="home.headline">…</h1>                  → textContent
//   <meta data-i18n-attr="content:meta.description">      → attribute(s), ";"-separated

import appConfig from '../config/app.json';
import { translate, resolveLocale } from '../shared/i18n-core.js';
import loaders from 'virtual:locales';

const STORAGE_KEY = 'locale';

export const ENABLED_LOCALES = appConfig.ENABLED_LOCALES;
export const DEFAULT_LOCALE = appConfig.DEFAULT_LOCALE;

let locale = DEFAULT_LOCALE;
let messages = {};
let fallbackMessages = {};
const listeners = new Set();

async function load(code) {
  const loader = loaders[code];
  return loader ? loader() : {};
}

function readStored() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function writeStored(code) {
  try { localStorage.setItem(STORAGE_KEY, code); } catch { /* private mode */ }
}

export function t(key, vars = {}) {
  return translate(key, { brand: appConfig.brand, ...vars }, messages, fallbackMessages);
}

export function getLocale() {
  return locale;
}

export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  });
}

export async function setLocale(code, { persist = true } = {}) {
  if (!ENABLED_LOCALES.includes(code)) code = DEFAULT_LOCALE;
  messages = code === DEFAULT_LOCALE ? fallbackMessages : await load(code);
  locale = code;
  document.documentElement.lang = code;
  if (persist) writeStored(code);
  applyTranslations();
  listeners.forEach((fn) => fn(code));
}

// Called when the user changes language (step 3 uses this to save profiles.locale).
export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function initI18n() {
  fallbackMessages = await load(DEFAULT_LOCALE);
  const requested = new URLSearchParams(location.search).get('lang');
  const code = resolveLocale({
    requested,
    stored: readStored(),
    browser: navigator.languages || [navigator.language],
    enabled: ENABLED_LOCALES,
    fallback: DEFAULT_LOCALE,
  });
  await setLocale(code, { persist: Boolean(requested) || Boolean(readStored()) });
}
