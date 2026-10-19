// Helpers for reading an exam config (config/exams/*.json). Nothing here knows
// about a specific language or level — lv-b1, lv-a1, et-b1 … all use this.

const ANSWER_TYPES = ['single_choice', 'true_false', 'matching', 'gap_fill', 'free_text', 'speech'];
const RUBRIC_ANSWER_TYPES = ['free_text', 'speech'];

export function getSkillIds(exam) {
  return exam.skills.map((s) => s.id);
}

export function getTaskType(exam, id) {
  const tt = exam.taskTypes.find((t) => t.id === id);
  if (!tt) throw new Error(`Unknown task type "${id}" in exam ${exam.code}`);
  return tt;
}

export function getRubric(exam, id) {
  const rubric = exam.rubrics?.[id];
  if (!rubric) throw new Error(`Unknown rubric "${id}" in exam ${exam.code}`);
  return rubric;
}

export function rubricMax(rubric) {
  return rubric.criteria.reduce((sum, c) => sum + c.max, 0);
}

// Max points of ONE item of a task type. Rubric-graded tasks are worth the
// rubric total unless the config sets maxPoints per item (then raw rubric
// scores are scaled to it — see scaleRubricScore in scoring.js).
export function itemMax(exam, taskType) {
  if (taskType.maxPoints != null) return taskType.maxPoints;
  if (taskType.rubric) return rubricMax(getRubric(exam, taskType.rubric));
  return taskType.pointsPerItem;
}

// Max points of a skill in the full exam (sum over its task types).
export function skillMax(exam, skillId) {
  return exam.taskTypes
    .filter((t) => t.skill === skillId)
    .reduce((sum, t) => sum + t.items * itemMax(exam, t), 0);
}

// Every "_placeholder": true found anywhere in the config, as readable paths.
export function placeholderPaths(node, path = '') {
  if (!node || typeof node !== 'object') return [];
  const here = node._placeholder === true ? [path || '(root)'] : [];
  const children = Object.entries(node).flatMap(([k, v]) =>
    placeholderPaths(v, Array.isArray(node) ? `${path}[${k}]` : path ? `${path}.${k}` : k)
  );
  return [...here, ...children];
}

// Structural checks. Returns a list of error strings (empty = valid).
export function validateExamConfig(exam) {
  const errors = [];
  const err = (msg) => errors.push(msg);

  if (!/^[a-z]{2}-[a-z0-9]+$/.test(exam.code || '')) err('code must look like "lv-b1"');
  if (!exam.contentLanguage) err('contentLanguage is required');

  const rule = exam.passRule || {};
  if (rule.type !== 'per_skill_min') err('passRule.type must be "per_skill_min"');
  if (!(rule.minRatio > 0 && rule.minRatio <= 1)) err('passRule.minRatio must be in (0, 1]');
  const est = rule.estimate || {};
  if (!(est.likelyFailBelow <= rule.minRatio && rule.minRatio <= est.likelyPassFrom)) {
    err('passRule.estimate must satisfy likelyFailBelow <= minRatio <= likelyPassFrom');
  }

  const skillIds = (exam.skills || []).map((s) => s.id);
  if (skillIds.length === 0) err('skills must not be empty');
  if (new Set(skillIds).size !== skillIds.length) err('skill ids must be unique');

  const ttIds = new Set();
  for (const t of exam.taskTypes || []) {
    const where = `taskTypes.${t.id}`;
    if (ttIds.has(t.id)) err(`${where}: duplicate id`);
    ttIds.add(t.id);
    if (!skillIds.includes(t.skill)) err(`${where}: unknown skill "${t.skill}"`);
    if (!ANSWER_TYPES.includes(t.answerType)) err(`${where}: unknown answerType "${t.answerType}"`);
    if (!(Number.isInteger(t.items) && t.items > 0)) err(`${where}: items must be a positive integer`);
    if (RUBRIC_ANSWER_TYPES.includes(t.answerType)) {
      if (!exam.rubrics?.[t.rubric]) err(`${where}: rubric "${t.rubric}" not found`);
    } else if (!(t.pointsPerItem > 0)) {
      err(`${where}: pointsPerItem must be > 0`);
    }
    if (t.wordLimits && !(t.wordLimits.min > 0 && t.wordLimits.max >= t.wordLimits.min)) {
      err(`${where}: wordLimits must have 0 < min <= max`);
    }
  }
  for (const id of skillIds) {
    if (!(exam.taskTypes || []).some((t) => t.skill === id)) err(`skill "${id}" has no task types`);
  }

  for (const [rid, rubric] of Object.entries(exam.rubrics || {})) {
    const cids = new Set();
    for (const c of rubric.criteria || []) {
      const where = `rubrics.${rid}.${c.id}`;
      if (cids.has(c.id)) err(`${where}: duplicate criterion id`);
      cids.add(c.id);
      if (!(c.max > 0)) err(`${where}: max must be > 0`);
      errors.push(...validateBands(c, where));
    }
    if (cids.size === 0) err(`rubrics.${rid}: criteria must not be empty`);
  }

  for (const s of exam.diagnostic?.sections || []) {
    const where = `diagnostic.${s.skill}`;
    if (!skillIds.includes(s.skill)) err(`${where}: unknown skill`);
    const tt = (exam.taskTypes || []).find((t) => t.id === s.taskType);
    if (!tt) err(`${where}: unknown taskType "${s.taskType}"`);
    else if (tt.skill !== s.skill) err(`${where}: taskType belongs to skill "${tt.skill}"`);
  }

  return errors;
}

// Bands must cover 0..max without gaps or overlaps, in ascending order.
function validateBands(criterion, where) {
  const errors = [];
  const bands = criterion.bands || [];
  if (bands.length === 0) return [`${where}: bands must not be empty`];
  let expectedMin = 0;
  bands.forEach((b, i) => {
    if (b.band !== i) errors.push(`${where}: bands must be numbered 0,1,2… in order`);
    if (b.min !== expectedMin) errors.push(`${where}: band ${b.band} should start at ${expectedMin}`);
    if (b.max < b.min) errors.push(`${where}: band ${b.band} max < min`);
    expectedMin = b.max + 1;
  });
  if (bands.at(-1).max !== criterion.max) errors.push(`${where}: last band must end at max (${criterion.max})`);
  return errors;
}
