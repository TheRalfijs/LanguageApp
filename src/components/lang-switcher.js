import appConfig from '../../config/app.json';
import { ENABLED_LOCALES, getLocale, setLocale } from '../i18n.js';

// Fills the header <select> from ENABLED_LOCALES and switches language on change.
export function mountLangSwitcher() {
  const wrap = document.querySelector('.lang-switcher');
  const select = wrap?.querySelector('select');
  if (!select) return;

  select.replaceChildren(
    ...ENABLED_LOCALES.map((code) => {
      const opt = new Option(appConfig.localeNames[code] || code, code);
      opt.lang = code;
      return opt;
    })
  );
  select.value = getLocale();
  select.addEventListener('change', () => setLocale(select.value));
  wrap.hidden = ENABLED_LOCALES.length < 2;
}
