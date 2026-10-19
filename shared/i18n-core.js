// Pure i18n helpers, shared by the browser (src/i18n.js), Netlify Functions
// (emails, feedback language) and tests. No DOM, no Vite-specific imports.

export function lookup(messages, key) {
  let node = messages;
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

// "Hello {name}" + { name: 'Anna' } → "Hello Anna". Unknown vars stay as-is.
export function interpolate(str, vars = {}) {
  return str.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

// Translate with fallback: active locale → default locale → the key itself.
export function translate(key, vars, messages, fallbackMessages) {
  const str = lookup(messages, key) ?? lookup(fallbackMessages, key) ?? key;
  return interpolate(str, vars);
}

// Pick the locale to use. A stored or requested locale that is no longer
// enabled (e.g. ru after ENABLED_LOCALES changes) falls through to the default.
export function resolveLocale({ requested, stored, browser = [], enabled, fallback }) {
  const ok = (code) => code && enabled.includes(code);
  if (ok(requested)) return requested;
  if (ok(stored)) return stored;
  for (const lang of browser) {
    const base = String(lang).toLowerCase().split('-')[0];
    if (ok(base)) return base;
  }
  return fallback;
}

// All leaf keys of a nested messages object, e.g. ["meta.title", ...].
export function flattenKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flattenKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`]
  );
}
