import appConfig from '../../config/app.json';
import { ENABLED_LOCALES, getLocale, setLocale, staticPageUrl } from '../i18n.js';

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
  select.addEventListener('change', async () => {
    const code = select.value;
    await setLocale(code); // remembers the choice (and saves it to the profile)
    // Static pages have a pre-rendered version per language: go there.
    const url = staticPageUrl(code);
    if (url) location.href = url;
  });
  wrap.hidden = ENABLED_LOCALES.length < 2;
}
