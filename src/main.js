// Entry point for every page: translations, header, footer, service worker.
// Page scripts do `import { ready } from '../main.js'; await ready;` — the
// module is shared, so boot() runs exactly once per page.
import { initI18n } from './i18n.js';
import { mountLangSwitcher } from './components/lang-switcher.js';
import { hasStoredSession } from './auth-hint.js';

async function boot() {
  await initI18n();
  mountLangSwitcher();
  document.querySelectorAll('[data-year]').forEach((el) => {
    el.textContent = new Date().getFullYear();
  });

  // Load auth (supabase-js) only when needed: logged-in visitors and pages
  // marked <body data-auth="…">. Keeps the landing page light.
  if (hasStoredSession() || document.body.dataset.auth) {
    const { initAuth } = await import('./auth.js');
    await initAuth();
  }

  if (import.meta.env.DEV) {
    import('./dev-warnings.js').then((m) => m.showDevWarnings());
  }

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

export const ready = boot();
