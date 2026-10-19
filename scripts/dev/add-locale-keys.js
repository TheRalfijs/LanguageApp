// Dev helper: merge a { key: [lv, en, uk, ru] } tree into locales/*.json,
// keeping "footer" last. Usage: node scripts/dev/add-locale-keys.js keys.json
import { readFileSync, writeFileSync } from 'node:fs';

const LOCALES = ['lv', 'en', 'uk', 'ru'];
const tree = JSON.parse(readFileSync(process.argv[2], 'utf8'));

const pick = (node, i) =>
  Object.fromEntries(Object.entries(node).map(([k, v]) => [k, Array.isArray(v) ? v[i] : pick(v, i)]));

function merge(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && dst[k] && typeof dst[k] === 'object') merge(dst[k], v);
    else dst[k] = v;
  }
}

LOCALES.forEach((locale, i) => {
  const file = `locales/${locale}.json`;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const { footer, ...rest } = data;
  merge(rest, pick(tree, i));
  writeFileSync(file, JSON.stringify({ ...rest, ...(footer ? { footer } : {}) }, null, 2) + '\n');
});
