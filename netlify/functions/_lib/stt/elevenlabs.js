// ElevenLabs Scribe: POST /v1/speech-to-text (multipart). Docs:
// https://elevenlabs.io/docs/api-reference/speech-to-text/convert
import { requireEnv, env } from '../env.js';

export function createElevenLabsStt({
  apiKey = requireEnv('ELEVENLABS_API_KEY'),
  model = env('ELEVENLABS_STT_MODEL', 'scribe_v2'),
  baseUrl = env('ELEVENLABS_BASE_URL', 'https://api.elevenlabs.io'),
  fetchImpl = fetch,
} = {}) {
  return {
    provider: 'elevenlabs',
    async transcribe({ audio, mimeType, language = 'lv' }) {
      const form = new FormData();
      form.append('model_id', model);
      form.append('language_code', language);
      form.append('timestamps_granularity', 'word');
      form.append('tag_audio_events', 'false');
      form.append('diarize', 'false');
      form.append('file', new Blob([audio], { type: mimeType }), `answer.${extFor(mimeType)}`);

      const res = await fetchImpl(`${baseUrl}/v1/speech-to-text`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey },
        body: form,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`ElevenLabs STT ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = await res.json();
      const words = (data.words || [])
        .filter((w) => w.type === 'word')
        .map((w) => ({
          text: w.text,
          start: w.start ?? null,
          end: w.end ?? null,
          confidence: typeof w.logprob === 'number' ? Math.exp(w.logprob) : null,
        }));
      const lastEnd = words.reduce((m, w) => Math.max(m, w.end ?? 0), 0);
      return {
        text: (data.text || '').trim(),
        words,
        durationSec: data.audio_duration_secs ?? lastEnd,
        language: data.language_code ?? language,
        provider: 'elevenlabs',
        model,
      };
    },
  };
}

function extFor(mimeType = '') {
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4') || mimeType.includes('m4a') || mimeType.includes('aac')) return 'm4a';
  if (mimeType.includes('wav')) return 'wav';
  return 'mp3';
}
