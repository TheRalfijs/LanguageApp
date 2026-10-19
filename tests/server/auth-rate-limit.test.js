import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setSupabaseAdminForTests } from '../../netlify/functions/_lib/supabase-admin.js';
import { getCaller, requireUser, requireAdmin, ownerOf, sha256 } from '../../netlify/functions/_lib/auth.js';
import { enforceRateLimit } from '../../netlify/functions/_lib/rate-limit.js';
import { HttpError } from '../../netlify/functions/_lib/http.js';

let counters;
let admins;
beforeEach(() => {
  counters = new Map();
  admins = new Set(['admin-id']);
  setSupabaseAdminForTests({
    auth: {
      getUser: async (token) =>
        token === 'good' ? { data: { user: { id: 'u1' } }, error: null }
          : token === 'admin' ? { data: { user: { id: 'admin-id' } }, error: null }
            : { data: { user: null }, error: new Error('bad jwt') },
    },
    from: () => {
      let id;
      const q = {
        select: () => q,
        eq: (_c, v) => { id = v; return q; },
        maybeSingle: async () => ({ data: { is_admin: admins.has(id) } }),
      };
      return q;
    },
    rpc: async (_fn, { p_key, p_bucket, p_limit }) => {
      const k = `${p_key}|${p_bucket}`;
      const n = counters.get(k) ?? 0;
      if (n >= p_limit) return { data: false, error: null };
      counters.set(k, n + 1);
      return { data: true, error: null };
    },
  });
});

const req = (headers = {}) => new Request('https://x.test/api/a', { headers });
const ANON = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('getCaller: valid bearer → user; anon token is hashed, never kept raw', async () => {
  const c = await getCaller(req({ authorization: 'Bearer good', 'x-anon-token': ANON }));
  assert.equal(c.user.id, 'u1');
  assert.equal(c.anonKey, sha256(ANON));
  assert.notEqual(c.anonKey, ANON);
});

test('getCaller: invalid bearer → 401; malformed anon token ignored', async () => {
  await assert.rejects(getCaller(req({ authorization: 'Bearer nope' })), (e) => e.status === 401);
  const c = await getCaller(req({ 'x-anon-token': 'short' }));
  assert.equal(c.anonKey, null);
});

test('requireUser / requireAdmin', async () => {
  await assert.rejects(requireUser(req()), (e) => e.status === 401);
  await assert.rejects(requireAdmin(req({ authorization: 'Bearer good' })), (e) => e.status === 403);
  const a = await requireAdmin(req({ authorization: 'Bearer admin' }));
  assert.equal(a.user.id, 'admin-id');
});

test('ownerOf: user wins, else anon hash, else 400', async () => {
  assert.deepEqual(ownerOf({ user: { id: 'u1' }, anonKey: 'h' }), { user_id: 'u1', anon_token: null });
  assert.deepEqual(ownerOf({ user: null, anonKey: 'h' }), { user_id: null, anon_token: 'h' });
  assert.throws(() => ownerOf({ user: null, anonKey: null }), HttpError);
});

const limits = { grading: { user: 2, anon: 1, anonIp: 2 } };

test('logged-in users: per-user daily limit', async () => {
  const caller = { user: { id: 'u1' }, anonKey: null, ipKey: 'ip1' };
  await enforceRateLimit(caller, 'grading', limits);
  await enforceRateLimit(caller, 'grading', limits);
  await assert.rejects(enforceRateLimit(caller, 'grading', limits), (e) => e.status === 429 && e.details.bucket === 'grading');
});

test('anonymous: limited per anon token AND per IP (a new token does not reset it)', async () => {
  await enforceRateLimit({ user: null, anonKey: 't1', ipKey: 'ip1' }, 'grading', limits);
  await assert.rejects(enforceRateLimit({ user: null, anonKey: 't1', ipKey: 'ip1' }, 'grading', limits), (e) => e.status === 429);
  await enforceRateLimit({ user: null, anonKey: 't2', ipKey: 'ip1' }, 'grading', limits); // 2nd on this IP
  await assert.rejects(enforceRateLimit({ user: null, anonKey: 't3', ipKey: 'ip1' }, 'grading', limits), (e) => e.status === 429);
});

test('anonymous without token → 400; unknown bucket throws; bucket with no anon limit blocks anon', async () => {
  await assert.rejects(enforceRateLimit({ user: null, anonKey: null, ipKey: 'i' }, 'grading', limits), (e) => e.status === 400);
  await assert.rejects(enforceRateLimit({ user: { id: 'u' } }, 'nope', limits), /Unknown rate limit/);
  await assert.rejects(enforceRateLimit({ user: null, anonKey: 't', ipKey: 'i' }, 'admin', { admin: { user: 5 } }), (e) => e.status === 429);
});
