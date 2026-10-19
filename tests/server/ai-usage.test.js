import { test } from 'node:test';
import assert from 'node:assert/strict';
import { llmCostEur, sttCostEur, ttsCostEur } from '../../netlify/functions/_lib/ai-usage.js';

const p = {
  usdToEur: 0.5,
  llm: {
    cheap: { inputPerMTokUsd: 1, outputPerMTokUsd: 2, cacheReadPerMTokUsd: 0.1, cacheWritePerMTokUsd: 1.25 },
    pricey: { inputPerMTokUsd: 10, outputPerMTokUsd: 50, cacheReadPerMTokUsd: 1, cacheWritePerMTokUsd: 12.5 },
  },
  stt: { elevenlabs: { perAudioHourUsd: 0.4 } },
  tts: { azure: { perMillionCharsUsd: 16 } },
};

test('LLM cost = tokens × rates, converted to EUR', () => {
  const { costEur, pricingKnown } = llmCostEur('cheap', {
    input_tokens: 1_000_000, output_tokens: 500_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 0,
  }, p);
  assert.equal(pricingKnown, true);
  assert.equal(costEur, (1 + 1 + 0.1) * 0.5);
});

test('unknown model is priced like the most expensive one and flagged', () => {
  const { costEur, pricingKnown } = llmCostEur('mystery', { input_tokens: 1_000_000, output_tokens: 0 }, p);
  assert.equal(pricingKnown, false);
  assert.equal(costEur, 5);
});

test('STT cost per audio second, TTS per character', () => {
  assert.equal(sttCostEur('elevenlabs', 3600, p), 0.2);
  assert.equal(sttCostEur('elevenlabs', 60, p), Math.round((0.2 / 60) * 1e5) / 1e5);
  assert.equal(ttsCostEur('azure', 1_000_000, p), 8);
  assert.equal(ttsCostEur('unknown', 1000, p), 0);
});
