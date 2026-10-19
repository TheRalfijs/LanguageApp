// Pre-rendering of "static" pages (landing, legal) into every enabled locale,
// so /en/… and /uk/… are real HTML for search engines and load without a
// flash of Latvian text. Used by vite.config.js in dev (middleware) and build.
//
// Conventions in static pages (<html data-static>):
// - data-i18n elements contain plain text only (no child tags);
// - long texts come from content/<name>.<locale>.html via <!-- @content name -->.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { translate } from '../shared/i18n-core.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);

// '/index.html' → '/', '/pages/legal/terms.html' stays.
export function publicPath(pagePath) {
  return pagePath.replace(/(^|\/)index\.html$/, '$1') || '/';
}

export function localizedPath(pagePath, locale, defaultLocale) {
  const p = publicPath(pagePath);
  return locale === defaultLocale ? p : `/${locale}${p}`;
}

export function seoBlock({ pagePath, locale, locales, defaultLocale, domain }) {
  const origin = `https://${domain}`;
  const url = (l) => origin + localizedPath(pagePath, l, defaultLocale);
  const links = [
    `<link rel="canonical" href="${url(locale)}">`,
    ...locales.map((l) => `<link rel="alternate" hreflang="${l}" href="${url(l)}">`),
    `<link rel="alternate" hreflang="x-default" href="${url(defaultLocale)}">`,
    '<script src="/locale-redirect.js"></script>',
  ];
  return `<!--seo-->\n${links.join('\n')}\n<!--/seo-->`;
}

export function contentFragment(root, name, locale) {
  const file = resolve(root, 'content', `${name}.${locale}.html`);
  if (!existsSync(file)) throw new Error(`Missing translation: content/${name}.${locale}.html`);
  return readFileSync(file, 'utf8');
}

// Applied to the Latvian source during the normal HTML transform.
export function prepareStaticPage(html, { root, pagePath, defaultLocale, locales, domain }) {
  return html
    .replace(/<html([^>]*)\sdata-static(?=[\s>])/, `<html$1 data-static-locale="${defaultLocale}"`)
    .replace(/<\/head>/, `${seoBlock({ pagePath, locale: defaultLocale, locales, defaultLocale, domain })}\n</head>`)
    .replace(/<!--\s*@content\s+([\w/-]+)\s*-->/g, (_, name) =>
      `<!--content:${name}-->${contentFragment(root, name, defaultLocale)}<!--/content-->`
    );
}

export function isStaticHtml(html) {
  return /<html[^>]*\sdata-static(-locale="[a-z]+")?[\s>]/.test(html);
}

// Turn a prepared (Latvian) static page into `locale`.
export function renderLocale(html, opts) {
  const { root, pagePath, locale, defaultLocale, locales, domain, messages, fallbackMessages, vars, staticPaths } = opts;
  const t = (key) => escapeHtml(translate(key, vars, messages, fallbackMessages));

  // Every data-i18n element must be text-only, or we would silently skip it.
  const expected = (html.match(/\sdata-i18n="/g) || []).length;
  let replaced = 0;
  let out = html.replace(
    /<(\w+)((?:\s[^>]*?)?\sdata-i18n="([^"]+)"[^>]*)>([^<]*)<\/\1>/g,
    (m, tag, attrs, key) => {
      replaced += 1;
      return `<${tag}${attrs}>${t(key)}</${tag}>`;
    }
  );
  if (replaced !== expected) {
    throw new Error(`${pagePath}: ${expected - replaced} data-i18n element(s) contain child tags; static pages need text-only data-i18n elements`);
  }

  out = out.replace(/<(\w+)\b([^>]*\sdata-i18n-attr="([^"]+)"[^>]*)>/g, (m, tag, attrs, spec) => {
    let a = attrs;
    for (const pair of spec.split(';')) {
      const [attr, key] = pair.split(':').map((x) => x.trim());
      if (!attr || !key) continue;
      a = a.replace(new RegExp(`\\s${attr}="[^"]*"`), '') + ` ${attr}="${t(key)}"`;
    }
    return `<${tag}${a}>`;
  });

  out = out.replace(/<!--content:([\w/-]+)-->[\s\S]*?<!--\/content-->/g, (_, name) =>
    `<!--content:${name}-->${contentFragment(root, name, locale)}<!--/content-->`
  );

  out = out
    .replace(/<html([^>]*?)\slang="[^"]*"/, `<html$1 lang="${locale}"`)
    .replace(/data-static-locale="[^"]*"/, `data-static-locale="${locale}"`)
    .replace(/<!--seo-->[\s\S]*?<!--\/seo-->/, seoBlock({ pagePath, locale, locales, defaultLocale, domain }));

  // Internal links: static pages → localized URL; app pages → ?lang= so the choice carries over.
  out = out.replace(/\shref="(\/[^"#?]*)([^"]*)"/g, (m, path, rest) => {
    if (/^\/(assets|icons|src|@|node_modules)\//.test(path) || /\.(css|js|png|svg|webmanifest|json)$/.test(path)) return m;
    const page = path === '/' ? '/index.html' : path;
    if (staticPaths.has(page)) return ` href="${localizedPath(page, locale, defaultLocale)}${rest}"`;
    if (page.endsWith('.html')) {
      const [query, hash = ''] = rest.split('#');
      const q = query ? `${query}&lang=${locale}` : `?lang=${locale}`;
      return ` href="${path}${q}${hash ? '#' + hash : ''}"`;
    }
    return m;
  });

  return out;
}

// sitemap.xml with hreflang alternates for every static page and locale.
export function sitemapXml(pagePaths, { domain, defaultLocale, locales }) {
  const url = (p, l) => `https://${domain}${localizedPath(p, l, defaultLocale)}`;
  const entries = pagePaths.sort().flatMap((p) =>
    locales.map((l) => [
      '  <url>',
      `    <loc>${url(p, l)}</loc>`,
      ...locales.map((a) => `    <xhtml:link rel="alternate" hreflang="${a}" href="${url(p, a)}"/>`),
      '  </url>',
    ].join('\n'))
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n');
}
