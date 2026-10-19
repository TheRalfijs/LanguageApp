// Text with tappable error highlights. errors: [{ start, end, original,
// correction, explanation, category }] (already located by the server).
import { h } from '../dom.js';
import { t } from '../i18n.js';

export function renderHighlightedText(container, text, errors) {
  const detail = h('div', { class: 'error-detail', role: 'status', 'aria-live': 'polite', hidden: true });
  const para = h('p', { class: 'highlighted-text' });
  let pos = 0;
  let active = null;

  errors.forEach((err, i) => {
    if (err.start > pos) para.append(text.slice(pos, err.start));
    const btn = h('button', {
      type: 'button',
      class: 'error-mark',
      'aria-expanded': 'false',
      'aria-label': t('feedback.errorLabel', { n: i + 1, text: err.original }),
      onclick: () => {
        if (active === btn) return close();
        active?.setAttribute('aria-expanded', 'false');
        active = btn;
        btn.setAttribute('aria-expanded', 'true');
        detail.replaceChildren(
          h('p', { class: 'error-detail__fix' },
            h('del', {}, err.original), ' → ', h('ins', { lang: 'lv' }, err.correction)),
          h('p', {}, err.explanation),
          h('p', { class: 'muted' }, t(`feedback.category.${err.category}`)),
        );
        detail.hidden = false;
      },
    }, text.slice(err.start, err.end));
    para.append(btn);
    pos = err.end;
  });
  if (pos < text.length) para.append(text.slice(pos));

  function close() {
    active?.setAttribute('aria-expanded', 'false');
    active = null;
    detail.hidden = true;
  }

  container.replaceChildren(h('div', { lang: 'lv' }, para), detail);
}
