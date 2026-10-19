// Per-skill bars against the pass line (60% from the exam config).
// result = examResult(...) from shared/scoring.js (via /api/attempt-status).
import { h } from '../dom.js';
import { t } from '../i18n.js';

export function renderSkillBars(container, result, { order, minRatio = 0.6 } = {}) {
  const ids = order ?? Object.keys(result.skills).concat(result.missing ?? []);
  const list = h('ul', { class: 'skill-bars' });
  list.style.setProperty('--pass-line', `${minRatio * 100}%`);
  for (const id of ids) {
    const s = result.skills[id];
    const missing = !s;
    const status = missing ? 'not_attempted' : s.status;
    const li = h('li', { class: `skill-bar is-${status}` },
      h('span', { class: 'skill-bar__name', 'data-i18n': `skills.${id}` }, t(`skills.${id}`)),
      h('span', { class: 'skill-bar__pct' }, missing ? '—' : `${s.percent}%`),
      h('span', { class: 'skill-bar__track', 'aria-hidden': 'true' }, h('span', { class: 'skill-bar__fill' })),
      h('span', { class: 'skill-bar__status', 'data-i18n': `status.${status}` }, t(`status.${status}`)),
    );
    li.style.setProperty('--pct', missing ? 0 : s.percent);
    list.append(li);
  }
  container.replaceChildren(list);
}
