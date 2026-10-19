// Azure Speech text-to-speech (REST). Returns MP3 bytes.
// https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech
import { requireEnv, env } from '../env.js';

const escapeXml = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

// segments: [{ text, voice }] — several voices make a dialogue in one file.
export function buildSsml({ segments, locale, rate }) {
  const voices = segments
    .map((s) => `<voice name="${escapeXml(s.voice)}"><prosody rate="${escapeXml(rate)}">${escapeXml(s.text)}</prosody></voice>`)
    .join('');
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${escapeXml(locale)}">${voices}</speak>`;
}

export function createAzureTts({
  key = requireEnv('AZURE_SPEECH_KEY'),
  region = env('AZURE_SPEECH_REGION', 'westeurope'),
  fetchImpl = fetch,
} = {}) {
  return {
    provider: 'azure',
    async synthesize({ segments, locale, rate, format }) {
      const res = await fetchImpl(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': format,
          'User-Agent': 'b1-practice',
        },
        body: buildSsml({ segments, locale, rate }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Azure TTS ${res.status}: ${body.slice(0, 300)}`);
      }
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
