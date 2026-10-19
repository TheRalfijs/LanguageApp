// Dev-only: loud warning while any exam config still contains placeholders.
import lvB1 from '../config/exams/lv-b1.json';
import { placeholderPaths, validateExamConfig } from '../shared/exam-config.js';

export function showDevWarnings() {
  const problems = [];
  for (const exam of [lvB1]) {
    const errors = validateExamConfig(exam);
    if (errors.length) problems.push(`${exam.code}: INVALID — ${errors.join('; ')}`);
    const ph = placeholderPaths(exam);
    if (ph.length) problems.push(`${exam.code}: ${ph.length} placeholder section(s) — ${ph.join(', ')}`);
  }
  if (!problems.length) return;
  problems.forEach((p) => console.warn(`[exam config] ${p}`));
  const bar = document.createElement('div');
  bar.className = 'dev-warning';
  bar.setAttribute('role', 'status');
  bar.textContent = `DEV: exam config uses placeholders (${problems.length}). See console.`;
  document.body.prepend(bar);
}
