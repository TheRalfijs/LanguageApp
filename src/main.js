// Entry point for every page: translations, header, footer, service worker.
import { initI18n } from './i18n.js';
import { mountLangSwitcher } from './components/lang-switcher.js';

async function boot() {
  await initI18n();
  mountLangSwitcher();
  document.querySelectorAll('[data-year]').forEach((el) => {
    el.textContent = new Date().getFullYear();
  });

  if (import.meta.env.DEV) {
    import('./dev-warnings.js').then((m) => m.showDevWarnings());
  }

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

boot();
