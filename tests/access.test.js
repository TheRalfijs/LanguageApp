import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  computeAccessUntil, effectiveAccessUntil, isPurchaseActive, accessUntilForExam, hasExamAccess,
} from '../shared/access.js';

const { products } = JSON.parse(readFileSync(new URL('../config/app.json', import.meta.url), 'utf8'));
const D = (s) => new Date(s);
const ctx = { products, launchDate: null };
const paid = (over) => ({ status: 'paid', refunded_at: null, access_until: null, created_at: '2026-11-01T10:00:00Z', ...over });

test('b1_30 runs 30 days from payment', () => {
  const until = computeAccessUntil(products.b1_30, { paidAt: '2026-11-01T10:00:00Z' });
  assert.equal(until.toISOString(), '2026-12-01T10:00:00.000Z');
});

test('a new pass stacks on top of current access', () => {
  const until = computeAccessUntil(products.b1_90, {
    paidAt: '2026-11-01T10:00:00Z', currentUntil: '2026-11-21T10:00:00Z',
  });
  assert.equal(until.toISOString(), '2027-02-19T10:00:00.000Z'); // 21 Nov + 90 days
});

test('expired current access does not push the start into the past', () => {
  const until = computeAccessUntil(products.b1_30, {
    paidAt: '2026-11-01T10:00:00Z', currentUntil: '2026-10-01T10:00:00Z',
  });
  assert.equal(until.toISOString(), '2026-12-01T10:00:00.000Z');
});

test('founding pass: no access until launch, then 90 days from launch', () => {
  const fp = paid({ product: 'founding_pass' });
  assert.equal(effectiveAccessUntil(fp, ctx), null);
  assert.equal(isPurchaseActive(fp, D('2026-11-02'), ctx), false);

  const launched = { products, launchDate: '2027-01-15T00:00:00Z' };
  assert.equal(effectiveAccessUntil(fp, launched).toISOString(), '2027-04-15T00:00:00.000Z');
  assert.equal(isPurchaseActive(fp, D('2027-01-15T00:00:01Z'), launched), true);
  assert.equal(isPurchaseActive(fp, D('2027-04-15T00:00:00Z'), launched), false); // end is exclusive
});

test('stored access_until wins over derived value', () => {
  const fp = paid({ product: 'founding_pass', access_until: '2027-06-01T00:00:00Z' });
  assert.equal(effectiveAccessUntil(fp, { products, launchDate: '2027-01-15' }).toISOString(), '2027-06-01T00:00:00.000Z');
});

test('refunded, pending or expired purchases give no access', () => {
  const base = { product: 'b1_30', access_until: '2026-12-01T00:00:00Z' };
  const now = D('2026-11-15');
  assert.equal(isPurchaseActive(paid(base), now, ctx), true);
  assert.equal(isPurchaseActive(paid({ ...base, refunded_at: '2026-11-10' }), now, ctx), false);
  assert.equal(isPurchaseActive(paid({ ...base, status: 'pending' }), now, ctx), false);
  assert.equal(isPurchaseActive(paid(base), D('2026-12-01T00:00:00Z'), ctx), false);
});

test('accessUntilForExam picks the latest active pass for that exam only', () => {
  const list = [
    paid({ product: 'b1_30', access_until: '2026-12-01T00:00:00Z' }),
    paid({ product: 'b1_90', access_until: '2027-02-01T00:00:00Z' }),
    paid({ product: 'b1_90', access_until: '2027-09-01T00:00:00Z', refunded_at: '2026-11-05' }),
    paid({ product: 'essay_check' }),
  ];
  const now = D('2026-11-15');
  assert.equal(accessUntilForExam(list, 'lv-b1', now, ctx).toISOString(), '2027-02-01T00:00:00.000Z');
  assert.equal(hasExamAccess(list, 'lv-a1', now, ctx), false);
  assert.equal(hasExamAccess([paid({ product: 'essay_check' })], 'lv-b1', now, ctx), false);
});
