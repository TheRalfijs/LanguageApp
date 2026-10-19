import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, HttpError, readJson } from '../../netlify/functions/_lib/http.js';
import { ConfigError } from '../../netlify/functions/_lib/env.js';

const run = async (fn) => {
  const res = await handler(fn)(new Request('https://x.test/'), {});
  return { status: res.status, body: await res.json() };
};

test('HttpError → JSON with its status and code', async () => {
  const r = await run(() => { throw new HttpError(429, 'rate_limited', 'x', { bucket: 'grading' }); });
  assert.deepEqual(r, { status: 429, body: { error: 'rate_limited', details: { bucket: 'grading' } } });
});

test('missing configuration → 503 without naming the variable', async () => {
  const r = await run(() => { throw new ConfigError('Missing environment variable ANTHROPIC_API_KEY'); });
  assert.equal(r.status, 503);
  assert.doesNotMatch(JSON.stringify(r.body), /ANTHROPIC/);
});

test('unexpected errors → generic 500 (no internals leaked)', async () => {
  const orig = console.error;
  console.error = () => {};
  const r = await run(() => { throw new Error('db password is hunter2'); });
  console.error = orig;
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { error: 'internal_error' });
});

test('readJson: size limit and invalid JSON', async () => {
  const big = new Request('https://x.test/', { method: 'POST', body: 'x'.repeat(100) });
  await assert.rejects(readJson(big, { maxBytes: 10 }), (e) => e.status === 413);
  const bad = new Request('https://x.test/', { method: 'POST', body: '{nope' });
  await assert.rejects(readJson(bad), (e) => e.status === 400);
});
