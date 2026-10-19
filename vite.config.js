import { defineConfig } from 'vite';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, relative, join, dirname } from 'node:path';
import { prepareStaticPage, renderLocale, isStaticHtml, sitemapXml } from './scripts/static-locales.js';

const root = import.meta.dirname;
const readJson = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const appConfig = readJson('config/app.json');
const { DEFAULT_LOCALE, ENABLED_LOCALES, domain, brand } = appConfig;
const OTHER_LOCALES = ENABLED_LOCALES.filter((l) => l !== DEFAULT_LOCALE);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'partials', 'public', 'content', '.netlify', '.git']);

// Every .html file in the project is a page (multi-page app, no SPA router).
function findPages(dir, out = {}) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) findPages(join(dir, entry.name), out);
    } else if (entry.name.endsWith('.html')) {
      const file = join(dir, entry.name);
      out[relative(root, file).replace(/\.html$/, '').replace(/\\/g, '/')] = file;
    }
  }
  return out;
}

const pages = findPages(root);
// Static pages: <html data-static> — pre-rendered per locale (/en/…, /uk/…).
const staticPaths = new Set(
  Object.values(pages)
    .filter((file) => isStaticHtml(readFileSync(file, 'utf8')))
    .map((file) => '/' + relative(root, file).replace(/\\/g, '/'))
);

const vars = { brand, domain };
const fill = (html) => html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));

function localeOptions(locale, pagePath) {
  return {
    root, pagePath, locale, staticPaths, domain,
    defaultLocale: DEFAULT_LOCALE,
    locales: ENABLED_LOCALES,
    messages: readJson(`locales/${locale}.json`),
    fallbackMessages: readJson(`locales/${DEFAULT_LOCALE}.json`),
    vars,
  };
}

// In-house HTML templating + per-locale static pages.
//  <!-- @include header -->   → partials/header.html
//  <!-- @content legal/terms --> → content/legal/terms.<locale>.html (static pages)
//  {{brand}} / {{domain}}     → config/app.json
function htmlPages() {
  return {
    name: 'html-pages',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        let out = html.replace(/<!--\s*@include\s+([\w-]+)\s*-->/g, (_, name) =>
          readFileSync(resolve(root, 'partials', `${name}.html`), 'utf8')
        );
        if (isStaticHtml(out)) {
          out = prepareStaticPage(out, {
            root, pagePath: ctx.path, defaultLocale: DEFAULT_LOCALE, locales: ENABLED_LOCALES, domain,
          });
        }
        return fill(out);
      },
    },

    // Dev: serve /en/… and /uk/… by rendering the Latvian source on the fly.
    configureServer(server) {
      const prefix = new RegExp(`^/(${OTHER_LOCALES.join('|')})(/[^?]*)?(\\?.*)?$`);
      server.middlewares.use(async (req, res, next) => {
        const m = OTHER_LOCALES.length && req.url.match(prefix);
        if (!m) return next();
        const rest = !m[2] || m[2] === '/' ? '/index.html' : m[2];
        if (!staticPaths.has(rest)) return next();
        try {
          const raw = readFileSync(resolve(root, rest.slice(1)), 'utf8');
          const html = await server.transformIndexHtml(rest, raw, req.originalUrl);
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(fill(renderLocale(html, localeOptions(m[1], rest))));
        } catch (e) {
          next(e);
        }
      });
    },

    handleHotUpdate({ file, server }) {
      if (/[\\/](partials|content|locales)[\\/]/.test(file)) server.ws.send({ type: 'full-reload' });
    },

    // Build: write dist/<locale>/<page>.html for every static page,
    // plus sitemap.xml and robots.txt (they need the domain from config).
    closeBundle() {
      const dist = resolve(root, 'dist');
      if (!existsSync(dist)) return;
      writeFileSync(join(dist, 'sitemap.xml'), sitemapXml([...staticPaths], { domain, defaultLocale: DEFAULT_LOCALE, locales: ENABLED_LOCALES }));
      writeFileSync(join(dist, 'robots.txt'), [
        'User-agent: *',
        'Disallow: /pages/admin/',
        'Disallow: /pages/account.html',
        'Disallow: /pages/login.html',
        `Sitemap: https://${domain}/sitemap.xml`,
        '',
      ].join('\n'));
      for (const pagePath of staticPaths) {
        const built = readFileSync(join(dist, pagePath), 'utf8');
        for (const locale of OTHER_LOCALES) {
          const target = join(dist, locale, pagePath);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, fill(renderLocale(built, localeOptions(locale, pagePath))));
        }
      }
    },
  };
}

// virtual:locales → lazy loaders for ENABLED_LOCALES only, so a disabled
// locale (e.g. ru) is not shipped in the bundle at all.
function enabledLocales() {
  const id = 'virtual:locales';
  return {
    name: 'enabled-locales',
    resolveId: (source) => (source === id ? '\0' + id : null),
    load(resolvedId) {
      if (resolvedId !== '\0' + id) return null;
      const entries = ENABLED_LOCALES.map(
        (code) => `  ${JSON.stringify(code)}: () => import('/locales/${code}.json').then((m) => m.default),`
      );
      return `export default {\n${entries.join('\n')}\n};\n`;
    },
  };
}

export default defineConfig({
  appType: 'mpa', // unknown URLs 404 in dev too, like on Netlify
  plugins: [htmlPages(), enabledLocales()],
  build: {
    rollupOptions: { input: pages },
  },
});
