import { defineConfig } from 'vite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';

const root = import.meta.dirname;
const appConfig = JSON.parse(readFileSync(resolve(root, 'config/app.json'), 'utf8'));
const SKIP_DIRS = new Set(['node_modules', 'dist', 'partials', 'public', '.netlify', '.git']);

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

// Tiny in-house HTML templating: <!-- @include header --> pulls in
// partials/header.html; {{brand}} / {{domain}} come from config/app.json.
function htmlPartials() {
  const vars = { brand: appConfig.brand, domain: appConfig.domain };
  const fill = (html) => html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
  return {
    name: 'html-partials',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const included = html.replace(/<!--\s*@include\s+([\w-]+)\s*-->/g, (_, name) =>
          readFileSync(resolve(root, 'partials', `${name}.html`), 'utf8')
        );
        return fill(included);
      },
    },
    handleHotUpdate({ file, server }) {
      if (file.includes('/partials/')) server.ws.send({ type: 'full-reload' });
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
      const entries = appConfig.ENABLED_LOCALES.map(
        (code) => `  ${JSON.stringify(code)}: () => import('/locales/${code}.json').then((m) => m.default),`
      );
      return `export default {\n${entries.join('\n')}\n};\n`;
    },
  };
}

export default defineConfig({
  plugins: [htmlPartials(), enabledLocales()],
  build: {
    rollupOptions: { input: findPages(root) },
  },
});
