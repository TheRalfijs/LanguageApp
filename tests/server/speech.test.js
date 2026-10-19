import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElevenLabsStt } from '../../netlify/functions/_lib/stt/elevenlabs.js';
import { meanConfidence, transcribeAndLog } from '../../netlify/functions/_lib/stt/index.js';
import { buildSsml } from '../../netlify/functions/_lib/tts/azure.js';
import { resolveTtsRequest, cachePath, ensureTtsAudio } from '../../netlify/functions/_lib/tts/index.js';

test('ElevenLabs adapter: sends the right request and normalises the response', async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, init };
    return new Response(JSON.stringify({
      text: ' Labdien! ',
      language_code: 'lav',
      audio_duration_secs: 4.2,
      words: [
        { text: 'Labdien!', type: 'word', start: 0.1, end: 0.8, logprob: -0.1 },
        { text: ' ', type: 'spacing', start: 0.8, end: 0.9 },
        { text: 'es', type: 'word', start: 0.9, end: 1.1 },
      ],
    }), { status: 200 });
  };
  const stt = createElevenLabsStt({ apiKey: 'k', fetchImpl });
  const out = await stt.transcribe({ audio: new Uint8Array([1, 2, 3]), mimeType: 'audio/webm;codecs=opus', language: 'lv' });

  assert.equal(sent.url, 'https://api.elevenlabs.io/v1/speech-to-text');
  assert.equal(sent.init.headers['xi-api-key'], 'k');
  const form = sent.init.body;
  assert.equal(form.get('model_id'), 'scribe_v2');
  assert.equal(form.get('language_code'), 'lv');
  assert.equal(form.get('timestamps_granularity'), 'word');
  assert.equal(form.get('file').name, 'answer.webm');

  assert.equal(out.text, 'Labdien!');
  assert.equal(out.words.length, 2, 'spacing tokens dropped');
  assert.ok(Math.abs(out.words[0].confidence - Math.exp(-0.1)) < 1e-9);
  assert.equal(out.words[1].confidence, null);
  assert.equal(out.durationSec, 4.2);
  assert.ok(Math.abs(meanConfidence(out.words) - Math.exp(-0.1)) < 1e-9);
});

test('ElevenLabs adapter: HTTP errors throw (key never in the message)', async () => {
  const stt = createElevenLabsStt({ apiKey: 'secret-key', fetchImpl: async () => new Response('quota', { status: 429 }) });
  await assert.rejects(stt.transcribe({ audio: new Uint8Array([1]), mimeType: 'audio/webm' }), (e) => /429/.test(e.message) && !/secret-key/.test(e.message));
});

test('transcribeAndLog logs audio seconds and cost', async () => {
  const logs = [];
  const stt = { transcribe: async () => ({ text: 'x', words: [], durationSec: 60, provider: 'elevenlabs', model: 'scribe_v2' }) };
  await transcribeAndLog(stt, { language: 'lv' }, { userId: 'u1', operation: 'transcribe' }, async (r) => logs.push(r));
  assert.equal(logs[0].units, 60);
  assert.equal(logs[0].unitType, 'audio_seconds');
  assert.ok(logs[0].costEur > 0);
});

test('SSML escapes text and supports dialogues', () => {
  const ssml = buildSsml({ locale: 'lv-LV', rate: '-5%', segments: [{ voice: 'A', text: 'Tom & Jerry <3' }, { voice: 'B', text: 'Labi' }] });
  assert.match(ssml, /xml:lang="lv-LV"/);
  assert.match(ssml, /Tom &amp; Jerry &lt;3/);
  assert.equal((ssml.match(/<voice /g) || []).length, 2);
});

test('TTS request: voice aliases and defaults from config/tts.json', () => {
  const r = resolveTtsRequest({ language: 'lv', text: ' Sveiki ' });
  assert.equal(r.locale, 'lv-LV');
  assert.deepEqual(r.segments, [{ text: 'Sveiki', voice: 'lv-LV-EveritaNeural' }]);
  const d = resolveTtsRequest({ language: 'lv', segments: [{ text: 'A', voice: 'male' }, { text: 'B' }] });
  assert.deepEqual(d.segments.map((s) => s.voice), ['lv-LV-NilsNeural', 'lv-LV-EveritaNeural']);
  assert.throws(() => resolveTtsRequest({ language: 'xx', text: 'a' }), /No TTS settings/);
  assert.throws(() => resolveTtsRequest({ language: 'lv', text: '  ' }), /empty/);
});

test('cache path is stable and changes with anything that affects the sound', () => {
  const a = resolveTtsRequest({ language: 'lv', text: 'Sveiki' });
  const b = resolveTtsRequest({ language: 'lv', text: 'Sveiki', voice: 'male' });
  assert.equal(cachePath('azure', a), cachePath('azure', resolveTtsRequest({ language: 'lv', text: 'Sveiki ' })));
  assert.notEqual(cachePath('azure', a), cachePath('azure', b));
  assert.match(cachePath('azure', a), /^lv-LV\/[0-9a-f]{2}\/[0-9a-f]{64}\.mp3$/);
});

function fakeStorage(existing = new Set()) {
  const uploads = [];
  return {
    uploads,
    exists: async (p) => existing.has(p),
    upload: async (p, bytes) => { uploads.push({ p, bytes }); existing.add(p); },
    publicUrl: (p) => `https://cdn.test/${p}`,
  };
}

test('ensureTtsAudio: generates once, then serves from cache', async () => {
  let synths = 0;
  const provider = { provider: 'azure', synthesize: async () => { synths += 1; return new Uint8Array([9]); } };
  const storage = fakeStorage();
  const logs = [];
  const log = async (r) => logs.push(r);

  const first = await ensureTtsAudio({ language: 'lv', text: 'Labrīt' }, { provider, storage, log });
  const second = await ensureTtsAudio({ language: 'lv', text: 'Labrīt' }, { provider, storage, log });

  assert.equal(first.generated, true);
  assert.equal(second.generated, false);
  assert.equal(first.path, second.path);
  assert.equal(synths, 1, 'Azure called exactly once');
  assert.equal(storage.uploads.length, 1);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].units, 'Labrīt'.length);
  assert.equal(second.url, `https://cdn.test/${first.path}`);
});
