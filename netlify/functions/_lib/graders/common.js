// Shared pieces for the AI graders.
import { scoreRubric } from '../../../../shared/scoring.js';

export const LANGUAGE_NAMES = { lv: 'Latvian', en: 'English', uk: 'Ukrainian', ru: 'Russian', et: 'Estonian' };
export const ERROR_CATEGORIES = ['grammar', 'spelling', 'vocabulary', 'word_order', 'punctuation', 'style'];

export function rubricText(rubric) {
  return rubric.criteria
    .map((c) => {
      const bands = c.bands.map((b) => `    ${b.min === b.max ? b.min : `${b.min}–${b.max}`} points: ${b.descriptor}`).join('\n');
      return `- ${c.id} (0–${c.max} points): ${c.descriptor}${c.approximate ? ' [APPROXIMATE]' : ''}\n${bands}`;
    })
    .join('\n');
}

export function criteriaSchema(rubric) {
  return {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'score', 'comment'],
      properties: {
        id: { type: 'string', enum: rubric.criteria.map((c) => c.id) },
        score: { type: 'integer', minimum: 0, maximum: Math.max(...rubric.criteria.map((c) => c.max)) },
        comment: { type: 'string' },
      },
    },
  };
}

export const errorsSchema = {
  type: 'array',
  maxItems: 20,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['original', 'correction', 'explanation', 'category'],
    properties: {
      original: { type: 'string' },
      correction: { type: 'string' },
      explanation: { type: 'string' },
      category: { type: 'string', enum: ERROR_CATEGORIES },
    },
  },
};

// Semantic check used by llm.callStructured: every criterion once, in range.
export function rubricErrors(rubric, criteria) {
  try {
    scoreRubric(rubric, criteria);
    return [];
  } catch (e) {
    return [e.message];
  }
}

// Merge AI criteria with the rubric: max + band always come from the config.
export function finalCriteria(rubric, aiCriteria) {
  const scored = scoreRubric(rubric, aiCriteria);
  const comments = new Map(aiCriteria.map((c) => [c.id, c.comment]));
  return {
    criteria: scored.criteria.map((c) => ({
      ...c,
      comment: comments.get(c.id) ?? '',
      ...(rubric.criteria.find((d) => d.id === c.id)?.approximate ? { approximate: true } : {}),
    })),
    total: scored.total,
    maxTotal: scored.maxTotal,
  };
}

export function zeroCriteria(rubric, comment) {
  return rubric.criteria.map((c) => ({ id: c.id, score: 0, comment }));
}
