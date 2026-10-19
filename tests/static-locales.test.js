import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { renderLocale, prepareStaticPage, localizedPath } from '../scripts/static-locales.js';

const root = new URL('..', import.meta.url).pathname;
const app = JSON.parse(readFileSync(join(root, 'config/app.json'), 'utf8'));
const read = (p) => readFileSync(join(root, p), 'utf8');

function walk(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    if (['node_modules', 'dist', '.git'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(join(root, p)).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const htmlPages = walk('.').filter((p) => p.endsWith('.html') && !p.startsWith('content') && !p.startsWith('partials'));
const contentFiles = walk('content').filter((p) => p.endsWith('.html'));

const baseOpts = {
  root, locale: 'en', defaultLocale: 'lv', locales: ['lv', 'en', 'uk'], domain: 'example.lv',
  messages: { a: { title: 'Hello & "you"' }, d: 'Desc' },
  fallbackMessages: { a: { title: 'Sveiki' }, d: 'Apraksts' },
  vars: {}, staticPaths: new Set(['/index.html', '/pages/legal/terms.html']),
};

test('renderLocale translates text, attributes, lang and links', () => {
  const src = prepareStaticPage(
    '<html lang="lv" data-static><head><meta name="description" content="Apraksts" data-i18n-attr="content:d"></head><body>' +
      '<h1 class="x" data-i18n="a.title">Sveiki</h1>' +
      '<a href="/">home</a> <a href="/pages/legal/terms.html#s2">terms</a> ' +
      '<a href="/pages/diagnostic.html">app</a> <a href="/pages/x.html?a=1#h">q</a> <a href="/assets/a.css">css</a>' +
      '</body></html>',
    { root, pagePath: '/index.html', defaultLocale: 'lv', locales: ['lv', 'en', 'uk'], domain: 'example.lv' }
  );
  const out = renderLocale(src, { ...baseOpts, pagePath: '/index.html' });
  assert.match(out, /<html lang="en" data-static-locale="en">/);
  assert.match(out, /<h1 class="x" data-i18n="a.title">Hello &amp; &quot;you&quot;<\/h1>/);
  assert.match(out, /content="Desc"/);
  assert.doesNotMatch(out, /content="Apraksts"/);
  assert.match(out, /href="\/en\/"/);
  assert.match(out, /href="\/en\/pages\/legal\/terms.html#s2"/);
  assert.match(out, /href="\/pages\/diagnostic.html\?lang=en"/);
  assert.match(out, /href="\/pages\/x.html\?a=1&lang=en#h"/);
  assert.match(out, /href="\/assets\/a.css"/);
  assert.match(out, /<link rel="canonical" href="https:\/\/example.lv\/en\/">/);
  assert.match(out, /hreflang="x-default" href="https:\/\/example.lv\/"/);
});

test('renderLocale refuses data-i18n elements with child tags', () => {
  const src = '<html lang="lv" data-static-locale="lv"><head><!--seo--><!--/seo--></head><p data-i18n="a.title">Hi <b>x</b></p></html>';
  assert.throws(() => renderLocale(src, { ...baseOpts, pagePath: '/index.html' }), /child tags/);
});

test('localizedPath', () => {
  assert.equal(localizedPath('/index.html', 'lv', 'lv'), '/');
  assert.equal(localizedPath('/index.html', 'uk', 'lv'), '/uk/');
  assert.equal(localizedPath('/pages/legal/terms.html', 'en', 'lv'), '/en/pages/legal/terms.html');
});

test('every @content block has a file for every enabled locale', () => {
  for (const page of htmlPages) {
    for (const [, name] of read(page).matchAll(/<!--\s*@content\s+([\w/-]+)\s*-->/g)) {
      for (const l of app.ENABLED_LOCALES) {
        assert.ok(contentFiles.includes(`content/${name}.${l}.html`), `missing content/${name}.${l}.html (${page})`);
      }
    }
  }
});

test('translated content files have the same section structure as Latvian', () => {
  for (const lv of contentFiles.filter((f) => f.endsWith('.lv.html'))) {
    const count = (f) => (read(f).match(/<h2/g) || []).length;
    for (const l of app.ENABLED_LOCALES.filter((x) => x !== 'lv')) {
      const other = lv.replace('.lv.html', `.${l}.html`);
      assert.equal(count(other), count(lv), `${relative(root, other)} has a different number of sections`);
    }
  }
});

test('no page or content file uses forbidden claims', () => {
  const forbidden = /\bofficial|\bcertified|guarantee|oficiāl|sertificēt|garantē|офіційн|сертифікован|гарант|официальн|сертифицирован/i;
  for (const f of [...htmlPages, ...contentFiles, ...walk('partials')]) {
    const hit = read(f).match(forbidden);
    assert.equal(hit, null, `${f}: "${hit?.[0]}"`);
  }
});

test('every page shows the VIAA disclaimer footer', () => {
  for (const page of htmlPages) assert.match(read(page), /<!--\s*@include footer\s*-->/, page);
  assert.match(read('partials/footer.html'), /Nav saistīta ar VIAA/);
});
