// Deterministic writing checks (run in code before any AI grading).

// A "word" is a run of letters/digits (Unicode-aware, so ā, č, ž … count),
// allowing inner hyphens/apostrophes: "pēc-pusdienā" = 1, "10.30" = 1.
const WORD = /[\p{L}\p{N}]+(?:[-'’.][\p{L}\p{N}]+)*/gu;

export function countWords(text) {
  return (String(text ?? '').match(WORD) || []).length;
}

// → { count, min, max, status: 'ok' | 'too_short' | 'too_long' }
export function wordCheck(text, limits) {
  const count = countWords(text);
  const status = count < limits.min ? 'too_short' : count > limits.max ? 'too_long' : 'ok';
  return { count, min: limits.min, max: limits.max, status };
}

// Too little text to be worth sending to the AI: graded as 0 in code.
export function tooShortToGrade(count, limits) {
  return count < Math.max(10, Math.floor(limits.min * 0.25));
}

// Find each error's `original` in the text (in order, non-overlapping) and
// attach { start, end } so the UI can highlight it. Errors whose original
// cannot be found verbatim are returned separately (shown as a list instead).
export function locateErrors(text, errors) {
  const located = [];
  const unlocated = [];
  const taken = [];
  const overlaps = (s, e) => taken.some(([a, b]) => s < b && e > a);

  for (const err of errors) {
    const needle = (err.original || '').trim();
    let found = -1;
    if (needle) {
      let from = 0;
      while (from <= text.length) {
        const i = text.indexOf(needle, from);
        if (i === -1) break;
        if (!overlaps(i, i + needle.length)) { found = i; break; }
        from = i + 1;
      }
    }
    if (found === -1) {
      unlocated.push(err);
    } else {
      taken.push([found, found + needle.length]);
      located.push({ ...err, original: needle, start: found, end: found + needle.length });
    }
  }
  located.sort((a, b) => a.start - b.start);
  return { located, unlocated };
}
