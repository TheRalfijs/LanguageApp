// Database helpers for attempts/responses (service role).
import { supabaseAdmin } from './supabase-admin.js';
import { HttpError } from './http.js';
import { requireEnv } from './env.js';

export const AUDIO_BUCKET = 'speaking-audio';

// Owner = the logged-in user, or the anonymous browser that started it.
export function isOwner(attempt, caller) {
  if (caller.user && attempt.user_id === caller.user.id) return true;
  return !attempt.user_id && Boolean(caller.anonKey) && attempt.anon_token === caller.anonKey;
}

export async function loadOwnedAttempt(caller, attemptId, db = supabaseAdmin()) {
  if (typeof attemptId !== 'string' || !/^[0-9a-f-]{36}$/.test(attemptId)) throw new HttpError(400, 'invalid_attempt');
  const { data, error } = await db.from('attempts').select('*').eq('id', attemptId).maybeSingle();
  if (error) throw error;
  // Same answer for "missing" and "not yours": do not reveal which ids exist.
  if (!data || !isOwner(data, caller)) throw new HttpError(404, 'attempt_not_found');
  return data;
}

export async function loadItems(ids, { withKey = false } = {}, db = supabaseAdmin()) {
  if (!ids.length) return new Map();
  const cols = `id, exam_code, skill, task_type, content_json, audio_path${withKey ? ', answer_key_json' : ''}`;
  const { data, error } = await db.from('items').select(cols).in('id', ids);
  if (error) throw error;
  return new Map(data.map((it) => [it.id, it]));
}

export function publicAudioUrl(path) {
  if (!path) return null;
  return `${requireEnv('SUPABASE_URL')}/storage/v1/object/public/tts-cache/${path}`;
}

export const allPlanItemIds = (plan) => plan.sections.flatMap((s) => s.itemIds);
