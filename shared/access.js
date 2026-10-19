// Who has access to what, and until when. Works on purchases rows as stored in
// Supabase (snake_case). Dates may be Date objects or ISO strings.

const DAY_MS = 24 * 60 * 60 * 1000;
const toDate = (d) => (d == null ? null : d instanceof Date ? d : new Date(d));

// access_until to store when a time-based pass is paid (webhook).
// A new pass starts when the current access ends, so passes stack.
// Founding passes start at the product launch → null until a launch date is set.
export function computeAccessUntil(productCfg, { paidAt, currentUntil = null, launchDate = null }) {
  if (!productCfg?.accessDays) return null;
  let start;
  if (productCfg.accessStarts === 'launch') {
    if (!launchDate) return null;
    start = Math.max(toDate(launchDate).getTime(), toDate(paidAt).getTime());
  } else {
    start = Math.max(toDate(paidAt).getTime(), toDate(currentUntil)?.getTime() ?? 0);
  }
  return new Date(start + productCfg.accessDays * DAY_MS);
}

// access_until if stored; otherwise derived (founding pass once launch date is known).
export function effectiveAccessUntil(purchase, { products, launchDate = null }) {
  if (purchase.access_until) return toDate(purchase.access_until);
  const cfg = products[purchase.product];
  if (cfg?.accessStarts !== 'launch') return null;
  return computeAccessUntil(cfg, { paidAt: purchase.created_at, launchDate });
}

export function isPurchaseActive(purchase, now, ctx) {
  if (purchase.status !== 'paid' || purchase.refunded_at) return false;
  const until = effectiveAccessUntil(purchase, ctx);
  return Boolean(until) && toDate(now).getTime() < until.getTime();
}

// Latest access end for an exam across all active purchases, or null.
export function accessUntilForExam(purchases, examCode, now, ctx) {
  let latest = null;
  for (const p of purchases) {
    if (ctx.products[p.product]?.grantsExam !== examCode) continue;
    if (!isPurchaseActive(p, now, ctx)) continue;
    const until = effectiveAccessUntil(p, ctx);
    if (!latest || until > latest) latest = until;
  }
  return latest;
}

export function hasExamAccess(purchases, examCode, now, ctx) {
  return accessUntilForExam(purchases, examCode, now, ctx) !== null;
}
