// Text-to-speech with a permanent cache in Supabase Storage (bucket tts-cache).
// Audio is addressed by a hash of everything that affects the sound, so the
// same text+voice+rate is generated exactly once. Call this when items are
// created/approved (admin, scripts) — never per user request.
import ttsConfig from '../../../../config/tts.json' with { type: 'json' };
import { sha256 } from '../auth.js';
import { supabaseAdmin } from '../supabase-admin.js';
import { ttsCostEur, logUsage } from '../ai-usage.js';
import { createAzureTts } from './azure.js';

export const TTS_BUCKET = 'tts-cache';

const providers = { azure: createAzureTts };

export function getTtsProvider(name = ttsConfig.provider) {
  if (!providers[name]) throw new Error(`Unknown TTS provider "${name}"`);
  return providers[name]();
}

// Normalise the request: resolve voice aliases ("female") and defaults.
export function resolveTtsRequest({ language, segments, text, voice, rate }, cfg = ttsConfig) {
  const lang = cfg.languages[language];
  if (!lang) throw new Error(`No TTS settings for language "${language}"`);
  const pick = (v) => lang.voices[v ?? lang.defaultVoice] ?? v;
  const segs = (segments ?? [{ text, voice }]).map((s) => ({ text: s.text.trim(), voice: pick(s.voice ?? voice) }));
  if (!segs.length || segs.some((s) => !s.text)) throw new Error('TTS text is empty');
  return { locale: lang.locale, rate: rate ?? lang.rate, format: cfg.format, segments: segs };
}

export function cachePath(provider, req) {
  const key = sha256(JSON.stringify([provider, req.locale, req.rate, req.format, req.segments]));
  return `${req.locale}/${key.slice(0, 2)}/${key}.mp3`;
}

// Storage wrapper (injectable for tests).
export function supabaseTtsStorage(client = supabaseAdmin()) {
  const bucket = () => client.storage.from(TTS_BUCKET);
  return {
    async exists(path) {
      const dir = path.slice(0, path.lastIndexOf('/'));
      const file = path.slice(path.lastIndexOf('/') + 1);
      const { data, error } = await bucket().list(dir, { search: file, limit: 1 });
      if (error) throw error;
      return (data || []).some((o) => o.name === file);
    },
    async upload(path, bytes) {
      const { error } = await bucket().upload(path, bytes, {
        contentType: 'audio/mpeg', upsert: false, cacheControl: '31536000',
      });
      // Someone else generated the same audio a moment ago: that's fine.
      if (error && !(String(error.statusCode) === '409' || /exists/i.test(error.message))) throw error;
    },
    publicUrl(path) {
      return bucket().getPublicUrl(path).data.publicUrl;
    },
  };
}

// → { path, url, generated }
export async function ensureTtsAudio(input, { provider = getTtsProvider(), storage = supabaseTtsStorage(), usage = {}, log = logUsage } = {}) {
  const req = resolveTtsRequest(input);
  const path = cachePath(provider.provider, req);
  if (await storage.exists(path)) return { path, url: storage.publicUrl(path), generated: false };

  const audio = await provider.synthesize(req);
  await storage.upload(path, audio);
  const chars = req.segments.reduce((n, s) => n + s.text.length, 0);
  await log({
    ...usage,
    operation: usage.operation ?? 'tts',
    provider: provider.provider,
    model: req.segments.map((s) => s.voice).join(','),
    units: chars,
    unitType: 'characters',
    costEur: ttsCostEur(provider.provider, chars),
    metadata: { path },
  });
  return { path, url: storage.publicUrl(path), generated: true };
}
