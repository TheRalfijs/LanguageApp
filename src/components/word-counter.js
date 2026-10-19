// Live word counter for a textarea, against the task's word limits.
import { wordCheck } from '../../shared/writing.js';
import { t, onLocaleChange } from '../i18n.js';

export function attachWordCounter(textarea, output, limits) {
  const render = () => {
    const c = wordCheck(textarea.value, limits);
    output.textContent = t('writing.wordCount', { count: c.count, min: c.min, max: c.max });
    output.dataset.status = c.status;
    return c;
  };
  textarea.addEventListener('input', render);
  onLocaleChange(render);
  return render();
}
