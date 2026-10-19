// Manual smoke test of the real AI providers with your keys (costs a few cents).
//   node --env-file=.env scripts/smoke-ai.js [llm] [tts] [stt]
// Writes scripts/.smoke/tts.mp3. Does not touch Supabase (costs are printed, not logged).
import { mkdirSync, writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { createLlm } from '../netlify/functions/_lib/llm.js';
import { createAzureTts } from '../netlify/functions/_lib/tts/azure.js';
import { resolveTtsRequest } from '../netlify/functions/_lib/tts/index.js';
import { createElevenLabsStt } from '../netlify/functions/_lib/stt/elevenlabs.js';
import { ttsCostEur, sttCostEur } from '../netlify/functions/_lib/ai-usage.js';

const which = new Set(process.argv.slice(2).length ? process.argv.slice(2) : ['llm', 'tts', 'stt']);
const printLog = async (row) => console.log(`  cost logged: €${row.costEur} (${row.units} ${row.unitType}, ${row.model})`);
let audio = null;

if (which.has('llm')) {
  console.log(`LLM (${process.env.LLM_MODEL}) …`);
  const llm = createLlm({
    client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    model: process.env.LLM_MODEL,
    effort: process.env.LLM_EFFORT || 'medium',
    fallbacks: process.env.LLM_FALLBACKS || 'default',
    log: printLog,
  });
  const out = await llm.callStructured({
    system: 'You check Latvian sentences. Corrections in Latvian, explanation in English.',
    prompt: 'Sentence: "Es iet uz veikals rīt."',
    schema: {
      type: 'object', additionalProperties: false, required: ['correct', 'correction', 'explanation'],
      properties: { correct: { type: 'boolean' }, correction: { type: 'string' }, explanation: { type: 'string' } },
    },
    usage: { operation: 'smoke_test' },
    maxTokens: 2000,
  });
  console.log('  →', out.data, `(attempts: ${out.attempts.length})`);
}

if (which.has('tts')) {
  console.log('TTS (Azure) …');
  const req = resolveTtsRequest({ language: 'lv', text: 'Labdien! Es dzīvoju Rīgā un strādāju veikalā.' });
  audio = await createAzureTts().synthesize(req);
  mkdirSync('scripts/.smoke', { recursive: true });
  writeFileSync('scripts/.smoke/tts.mp3', audio);
  const chars = req.segments.reduce((n, s) => n + s.text.length, 0);
  console.log(`  → scripts/.smoke/tts.mp3 (${audio.length} bytes, ~€${ttsCostEur('azure', chars)})`);
}

if (which.has('stt')) {
  if (!audio) throw new Error('Run stt together with tts (it transcribes the generated audio).');
  console.log('STT (ElevenLabs) …');
  const out = await createElevenLabsStt().transcribe({ audio, mimeType: 'audio/mpeg', language: 'lv' });
  console.log(`  → "${out.text}" (${out.words.length} words, ${out.durationSec}s, ~€${sttCostEur('elevenlabs', out.durationSec)})`);
}
