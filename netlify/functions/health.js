// GET /api/health → which services are configured (booleans only, never values).
import { handler, json, allowMethods } from './_lib/http.js';

const has = (...names) => names.every((n) => Boolean(process.env[n]));

export default handler(async (req) => {
  allowMethods(req, 'GET');
  return json(200, {
    ok: true,
    services: {
      supabase: has('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'),
      llm: has('ANTHROPIC_API_KEY', 'LLM_MODEL'),
      stt: has('ELEVENLABS_API_KEY'),
      tts: has('AZURE_SPEECH_KEY'),
      stripe: has('STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'),
      email: has('RESEND_API_KEY', 'EMAIL_FROM'),
      anonHashSalt: has('ANON_HASH_SALT'),
    },
  });
});

export const config = { path: '/api/health' };
