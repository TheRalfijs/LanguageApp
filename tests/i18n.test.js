import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flattenKeys, interpolate, resolveLocale, translate } from '../shared/i18n-core.js';

const readJson = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const app = readJson('config/app.json');
const LOCALES = ['lv', 'en', 'uk', 'ru'];
const messages = Object.fromEntries(LOCALES.map((l) => [l, readJson(`locales/${l}.json`)]));

test('every locale file has exactly the same keys as lv.json', () => {
  const base = flattenKeys(messages.lv).sort();
  for (const l of LOCALES.filter((x) => x !== 'lv')) {
    assert.deepEqual(flattenKeys(messages[l]).sort(), base, `${l}.json keys differ from lv.json`);
  }
});

test('footer disclaimer is present in every locale', () => {
  assert.equal(messages.lv.footer.disclaimer, 'Neatkarīga mācību platforma. Nav saistīta ar VIAA.');
  for (const l of LOCALES) assert.match(messages[l].footer.disclaimer, /VIAA/);
});

test('no locale uses forbidden claims (official / certified / guaranteed)', () => {
  const forbidden = /\bofficial|\bcertified|guarantee|oficiāl|sertificēt|garantē|офіційн|сертифікован|гарант|официальн|сертифицирован/i;
  for (const l of LOCALES) {
    for (const key of flattenKeys(messages[l])) {
      const value = key.split('.').reduce((o, k) => o[k], messages[l]);
      assert.doesNotMatch(value, forbidden, `${l}:${key} → "${value}"`);
    }
  }
});

test('ru exists but is disabled; default locale is lv and enabled', () => {
  assert.equal(app.DEFAULT_LOCALE, 'lv');
  assert.ok(app.ENABLED_LOCALES.includes('lv'));
  assert.ok(!app.ENABLED_LOCALES.includes('ru'));
});

test('interpolate replaces known vars and keeps unknown ones', () => {
  assert.equal(interpolate('Sveiki, {name}! {x}', { name: 'Anna' }), 'Sveiki, Anna! {x}');
});

test('translate falls back to default locale, then to the key', () => {
  assert.equal(translate('a.b', {}, {}, { a: { b: 'LV' } }), 'LV');
  assert.equal(translate('missing.key', {}, {}, {}), 'missing.key');
});

test('resolveLocale: requested > stored > browser > fallback, only enabled codes', () => {
  const enabled = ['lv', 'en', 'uk'];
  const base = { enabled, fallback: 'lv' };
  assert.equal(resolveLocale({ ...base, requested: 'en', stored: 'uk' }), 'en');
  assert.equal(resolveLocale({ ...base, stored: 'uk', browser: ['en-US'] }), 'uk');
  assert.equal(resolveLocale({ ...base, browser: ['uk-UA', 'en'] }), 'uk');
  assert.equal(resolveLocale({ ...base, stored: 'ru', browser: ['ru-RU'] }), 'lv');
  assert.equal(resolveLocale({ ...base, browser: ['de-DE'] }), 'lv');
});
