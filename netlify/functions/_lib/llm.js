// Anthropic client for structured JSON calls (grading, item generation).
//
// - Model comes from LLM_MODEL; effort from LLM_EFFORT (default "medium").
// - Output is forced to JSON with output_config.format (json_schema) and then
//   validated again here with Ajv (full schema incl. numeric limits) plus an
//   optional semantic check. Invalid output → one retry with the errors
//   explained; still invalid → LlmError('invalid_output').
// - temperature 0 is sent only to models that still accept it: models after
//   Claude Opus 4.6 reject non-default temperature with a 400.
// - Server-side refusal fallback ("default") is on for models that support it.
// - Every attempt is logged to ai_usage with its estimated cost.
import Anthropic from '@anthropic-ai/sdk';
import Ajv from 'ajv';
import { env, requireEnv } from './env.js';
import { llmCostEur, logUsage } from './ai-usage.js';

export class LlmError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.code = code; // 'refusal' | 'invalid_output'
    this.details = details;
  }
}

const ajv = new Ajv({ allErrors: true, strict: false });
const compiled = new WeakMap();

const LEGACY_SAMPLING_MODELS = /^claude-(3|opus-4-[0-6]|sonnet-4-[0-6]|haiku-4-5)/;
const SERVER_FALLBACK_MODELS = /^claude-(fable-5-1|mythos-5-1|opus-5-5|opus-5|sonnet-5-5)$/;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export const acceptsTemperature = (model) => LEGACY_SAMPLING_MODELS.test(model);
export const supportsServerFallback = (model) => SERVER_FALLBACK_MODELS.test(model);

// Keywords the structured-output API does not support; Ajv still enforces them.
const UNSUPPORTED = new Set([
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems',
]);

export function toApiSchema(schema) {
  const walk = (node, isPropertyMap = false) => {
    if (Array.isArray(node)) return node.map((n) => walk(n));
    if (!node || typeof node !== 'object') return node;
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (!isPropertyMap && UNSUPPORTED.has(k)) continue;
      out[k] = walk(v, !isPropertyMap && (k === 'properties' || k === '$defs' || k === 'definitions'));
    }
    return out;
  };
  return walk(schema);
}

function validatorFor(schema) {
  if (!compiled.has(schema)) compiled.set(schema, ajv.compile(schema));
  return compiled.get(schema);
}

function schemaErrors(schema, data) {
  const validate = validatorFor(schema);
  if (validate(data)) return [];
  return validate.errors.map((e) => `${e.instancePath || '(root)'} ${e.message}`);
}

const textOf = (response) =>
  response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');

export function createLlm({ client, model, effort = 'medium', fallbacks = 'default', log = logUsage } = {}) {
  async function send(request) {
    if (fallbacks !== 'off' && supportsServerFallback(model)) {
      return client.beta.messages.create({ ...request, betas: [FALLBACK_BETA], fallbacks: 'default' });
    }
    return client.messages.create(request);
  }

  /**
   * @param {object} p
   * @param {string|Array} p.system
   * @param {string|Array} p.prompt         user content (string or content blocks)
   * @param {object} p.schema               full JSON Schema (validated with Ajv)
   * @param {(data) => string[]} [p.validate] extra semantic checks; return error strings
   * @param {object} p.usage                { userId, anonKey, operation } for ai_usage
   * @param {string} [p.promptVersion]      stored with the output for re-calibration
   */
  async function callStructured({ system, prompt, schema, validate, usage, promptVersion, maxTokens = 16000, metadata = {} }) {
    const messages = [{ role: 'user', content: prompt }];
    const attempts = [];
    let totalCost = 0;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const request = {
        model,
        max_tokens: maxTokens,
        system,
        messages,
        output_config: { effort, format: { type: 'json_schema', schema: toApiSchema(schema) } },
        ...(acceptsTemperature(model) ? { temperature: 0 } : {}),
      };
      const response = await send(request);
      const { costEur, pricingKnown } = llmCostEur(response.model, response.usage);
      totalCost += costEur;
      const fallbackUsed = (response.usage.iterations ?? []).some((i) => i.type === 'fallback_message');
      attempts.push({ attempt, model: response.model, stop_reason: response.stop_reason, usage: response.usage, fallbackUsed });

      await log({
        ...usage,
        provider: 'anthropic',
        model: response.model,
        units: (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0),
        unitType: 'tokens',
        costEur,
        metadata: {
          ...metadata, attempt, promptVersion, pricingKnown, fallbackUsed,
          stop_reason: response.stop_reason,
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          cache_read_input_tokens: response.usage.cache_read_input_tokens,
          cache_creation_input_tokens: response.usage.cache_creation_input_tokens,
        },
      });

      if (response.stop_reason === 'refusal') {
        throw new LlmError('refusal', 'Model declined the request', { stop_details: response.stop_details, attempts });
      }

      const raw = textOf(response);
      let errors;
      let data;
      if (response.stop_reason === 'max_tokens') {
        errors = ['Output was cut off (max_tokens). Be more concise.'];
      } else {
        try {
          data = JSON.parse(raw);
          errors = schemaErrors(schema, data);
          if (!errors.length && validate) errors = validate(data) || [];
        } catch {
          errors = ['Output is not valid JSON.'];
        }
      }

      if (!errors.length) {
        return { data, model: response.model, promptVersion, attempts, costEur: totalCost };
      }

      attempts.at(-1).errors = errors;
      if (attempt === 2) break;
      messages.push(
        { role: 'assistant', content: raw || '{}' },
        { role: 'user', content: `Your previous answer was invalid:\n- ${errors.join('\n- ')}\nReturn the complete corrected JSON.` }
      );
    }
    throw new LlmError('invalid_output', 'Model output failed validation twice', { attempts });
  }

  return { callStructured, model };
}

let defaultLlm = null;

// Lazily built from env: ANTHROPIC_API_KEY, LLM_MODEL, LLM_EFFORT, LLM_FALLBACKS.
export function getLlm() {
  defaultLlm ??= createLlm({
    client: new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') }),
    model: requireEnv('LLM_MODEL'),
    effort: env('LLM_EFFORT', 'medium'),
    fallbacks: env('LLM_FALLBACKS', 'default'),
  });
  return defaultLlm;
}
