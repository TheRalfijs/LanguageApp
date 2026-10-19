// Daily limits per user, and for anonymous visitors per anon token AND per
// hashed IP (clearing localStorage must not reset the limit).
import appConfig from '../../../config/app.json' with { type: 'json' };
import { supabaseAdmin } from './supabase-admin.js';
import { HttpError } from './http.js';

async function bump(key, bucket, limit) {
  const { data, error } = await supabaseAdmin().rpc('bump_rate_limit', { p_key: key, p_bucket: bucket, p_limit: limit });
  if (error) throw error;
  return data === true;
}

// bucket: a key of appConfig.rateLimits, e.g. 'grading'.
export async function enforceRateLimit(caller, bucket, limits = appConfig.rateLimits) {
  const cfg = limits[bucket];
  if (!cfg) throw new Error(`Unknown rate limit bucket "${bucket}"`);
  if (!caller.user && !caller.anonKey) throw new HttpError(400, 'anon_token_required');

  const checks = caller.user
    ? [[`user:${caller.user.id}`, cfg.user]]
    : [[`anon:${caller.anonKey}`, cfg.anon], [`ip:${caller.ipKey}`, cfg.anonIp]];

  for (const [key, limit] of checks) {
    if (!limit || !(await bump(key, bucket, limit))) {
      throw new HttpError(429, 'rate_limited', 'rate_limited', { bucket });
    }
  }
}
