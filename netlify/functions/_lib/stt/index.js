// Speech-to-text adapter. Every provider implements:
//
//   transcribe({ audio: Uint8Array, mimeType, language }) → {
//     text, words: [{ text, start, end, confidence }], durationSec, provider, model
//   }
//
// confidence is 0..1 (or null). Switch providers with STT_PROVIDER.
import { env } from '../env.js';
import { createElevenLabsStt } from './elevenlabs.js';
import { sttCostEur, logUsage } from '../ai-usage.js';

const factories = {
  elevenlabs: createElevenLabsStt,
};

export function getStt(name = env('STT_PROVIDER', 'elevenlabs')) {
  const factory = factories[name];
  if (!factory) throw new Error(`Unknown STT provider "${name}"`);
  return factory();
}

// Transcribe and log the cost in one step.
export async function transcribeAndLog(stt, input, usage, log = logUsage) {
  const result = await stt.transcribe(input);
  await log({
    ...usage,
    provider: result.provider,
    model: result.model,
    units: result.durationSec,
    unitType: 'audio_seconds',
    costEur: sttCostEur(result.provider, result.durationSec),
    metadata: { language: input.language, words: result.words.length },
  });
  return result;
}

// Mean word confidence — one weak signal for the "approximate" pronunciation score.
export function meanConfidence(words) {
  const values = words.map((w) => w.confidence).filter((c) => typeof c === 'number');
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}
