// Cost estimate + logging for every paid AI call (LLM, speech-to-text, TTS).
import pricing from '../../../config/ai-pricing.json' with { type: 'json' };
import { supabaseAdmin } from './supabase-admin.js';

const PER_M = 1_000_000;
const round5 = (n) => Math.round(n * 1e5) / 1e5;

// Unknown model → priced like the most expensive known model, flagged.
function llmRates(model, table = pricing.llm) {
  if (table[model]) return { rates: table[model], known: true };
  const priciest = Object.values(table).sort((a, b) => b.outputPerMTokUsd - a.outputPerMTokUsd)[0];
  return { rates: priciest, known: false };
}

export function llmCostEur(model, usage, p = pricing) {
  const { rates, known } = llmRates(model, p.llm);
  const usd =
    ((usage.input_tokens ?? 0) * rates.inputPerMTokUsd +
      (usage.output_tokens ?? 0) * rates.outputPerMTokUsd +
      (usage.cache_read_input_tokens ?? 0) * rates.cacheReadPerMTokUsd +
      (usage.cache_creation_input_tokens ?? 0) * rates.cacheWritePerMTokUsd) / PER_M;
  return { costEur: round5(usd * p.usdToEur), pricingKnown: known };
}

export function sttCostEur(provider, seconds, p = pricing) {
  const rate = p.stt[provider]?.perAudioHourUsd ?? 0;
  return round5((seconds / 3600) * rate * p.usdToEur);
}

export function ttsCostEur(provider, chars, p = pricing) {
  const rate = p.tts[provider]?.perMillionCharsUsd ?? 0;
  return round5((chars / PER_M) * rate * p.usdToEur);
}

// Never throws: a logging failure must not fail the user's request, but it is
// logged loudly so missing cost rows get noticed.
export async function logUsage(row) {
  try {
    const { error } = await supabaseAdmin().from('ai_usage').insert({
      user_id: row.userId ?? null,
      anon_key: row.anonKey ?? null,
      provider: row.provider,
      model: row.model ?? null,
      operation: row.operation,
      units: row.units ?? 0,
      unit_type: row.unitType ?? null,
      cost_eur: row.costEur ?? 0,
      metadata: row.metadata ?? null,
    });
    if (error) throw error;
  } catch (err) {
    console.error('[ai_usage] failed to log usage', row, err);
  }
}

// Usage context passed down from a function to the AI helpers.
export const usageContext = (caller, operation) => ({
  userId: caller?.user?.id ?? null,
  anonKey: caller?.user ? null : caller?.anonKey ?? null,
  operation,
});
