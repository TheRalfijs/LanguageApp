import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLlm, LlmError, toApiSchema, acceptsTemperature, supportsServerFallback } from '../../netlify/functions/_lib/llm.js';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'comment'],
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 3 },
    comment: { type: 'string', minLength: 1 },
  },
};

const reply = (text, extra = {}) => ({
  model: extra.model ?? 'claude-opus-5-5',
  stop_reason: extra.stop_reason ?? 'end_turn',
  stop_details: extra.stop_details ?? null,
  content: [{ type: 'text', text }],
  usage: { input_tokens: 1000, output_tokens: 200, ...(extra.usage ?? {}) },
});

// Fake SDK client: returns scripted replies, records requests.
function fakeClient(replies) {
  const calls = [];
  const create = async (req) => {
    calls.push(req);
    return replies.shift();
  };
  return { calls, messages: { create }, beta: { messages: { create } } };
}

const setup = (replies, opts = {}) => {
  const client = fakeClient(replies);
  const logs = [];
  const llm = createLlm({ client, model: 'claude-opus-5-5', log: async (r) => logs.push(r), ...opts });
  const call = (extra = {}) => llm.callStructured({
    system: 'grader', prompt: 'grade this', schema, usage: { userId: 'u1', operation: 'grade_writing' }, promptVersion: 'w1', ...extra,
  });
  return { client, logs, call };
};

test('valid output on the first try: one call, one usage row', async () => {
  const { client, logs, call } = setup([reply('{"score":2,"comment":"ok"}')]);
  const out = await call();
  assert.deepEqual(out.data, { score: 2, comment: 'ok' });
  assert.equal(out.promptVersion, 'w1');
  assert.equal(client.calls.length, 1);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].provider, 'anthropic');
  assert.equal(logs[0].operation, 'grade_writing');
  assert.equal(logs[0].units, 1200);
  assert.ok(logs[0].costEur > 0);
});

test('request shape: json_schema output, effort, no temperature on current models, server fallback', async () => {
  const { client, call } = setup([reply('{"score":2,"comment":"ok"}')]);
  await call();
  const req = client.calls[0];
  assert.equal(req.model, 'claude-opus-5-5');
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.equal(req.output_config.effort, 'medium');
  assert.equal(req.output_config.format.schema.properties.score.maximum, undefined, 'unsupported keywords stripped');
  assert.equal('temperature' in req, false);
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(req.fallbacks, 'default');
});

test('legacy models get temperature 0 and no fallback beta', async () => {
  const { client, call } = setup([reply('{"score":2,"comment":"ok"}', { model: 'claude-haiku-4-5' })], { model: 'claude-haiku-4-5' });
  await call();
  assert.equal(client.calls[0].temperature, 0);
  assert.equal(client.calls[0].betas, undefined);
});

test('LLM_FALLBACKS=off disables the fallback beta', async () => {
  const { client, call } = setup([reply('{"score":2,"comment":"ok"}')], { fallbacks: 'off' });
  await call();
  assert.equal(client.calls[0].fallbacks, undefined);
});

test('invalid output → one retry that explains the errors', async () => {
  const { client, logs, call } = setup([
    reply('{"score":7,"comment":"too high"}'),
    reply('{"score":3,"comment":"fixed"}'),
  ]);
  const out = await call();
  assert.equal(out.data.score, 3);
  assert.equal(client.calls.length, 2);
  assert.equal(logs.length, 2, 'both attempts are logged (both cost money)');
  const retry = client.calls[1].messages;
  assert.equal(retry.length, 3);
  assert.equal(retry[1].role, 'assistant');
  assert.match(retry[2].content, /score must be <= 3/);
  assert.equal(out.attempts[0].errors.length, 1);
});

test('still invalid after retry → LlmError invalid_output', async () => {
  const { call } = setup([reply('not json'), reply('{"score":"x"}')]);
  await assert.rejects(call(), (e) => e instanceof LlmError && e.code === 'invalid_output' && e.details.attempts.length === 2);
});

test('semantic validate() errors also trigger the retry', async () => {
  const { client, call } = setup([reply('{"score":1,"comment":"a"}'), reply('{"score":2,"comment":"b"}')]);
  const out = await call({ validate: (d) => (d.score < 2 ? ['score must be ≥ 2 for this test'] : []) });
  assert.equal(out.data.score, 2);
  assert.equal(client.calls.length, 2);
});

test('max_tokens cut-off counts as invalid', async () => {
  const { client, call } = setup([reply('{"score":2,', { stop_reason: 'max_tokens' }), reply('{"score":2,"comment":"ok"}')]);
  await call();
  assert.match(client.calls[1].messages[2].content, /cut off/);
});

test('refusal → LlmError refusal, no retry', async () => {
  const { client, logs, call } = setup([reply('', { stop_reason: 'refusal', stop_details: { category: 'cyber' } })]);
  await assert.rejects(call(), (e) => e instanceof LlmError && e.code === 'refusal');
  assert.equal(client.calls.length, 1);
  assert.equal(logs.length, 1);
});

test('toApiSchema strips unsupported keywords but not property names', () => {
  const s = toApiSchema({
    type: 'object',
    properties: { maximum: { type: 'number', maximum: 5 }, list: { type: 'array', minItems: 1, items: { type: 'string', maxLength: 9 } } },
  });
  assert.deepEqual(Object.keys(s.properties), ['maximum', 'list']);
  assert.equal(s.properties.maximum.maximum, undefined);
  assert.equal(s.properties.list.minItems, undefined);
  assert.equal(s.properties.list.items.maxLength, undefined);
});

test('model capability helpers', () => {
  assert.equal(acceptsTemperature('claude-opus-5-5'), false);
  assert.equal(acceptsTemperature('claude-sonnet-4-6'), true);
  assert.equal(supportsServerFallback('claude-opus-5-5'), true);
  assert.equal(supportsServerFallback('claude-haiku-5-5'), false);
});
