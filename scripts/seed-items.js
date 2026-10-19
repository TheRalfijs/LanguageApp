// Load original seed items into Supabase and generate their audio once.
//   node --env-file=.env scripts/seed-items.js [--dry-run] [--no-tts] [exam=lv-b1]
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (+ AZURE_SPEECH_KEY unless --no-tts).
// Idempotent: item ids are derived from seed_id, audio is cached by content hash.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateItem } from '../shared/items.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const noTts = args.includes('--no-tts');
const examCode = args.find((a) => a.startsWith('exam='))?.slice(5) ?? 'lv-b1';

const exam = JSON.parse(readFileSync(`config/exams/${examCode}.json`, 'utf8'));
const seed = JSON.parse(readFileSync(`content/items/${examCode}/seed.json`, 'utf8'));

// Stable UUID from seed_id (UUID-shaped SHA-256, version nibble 5).
function seedUuid(seedId) {
  const h = createHash('sha256').update(`seed:${seedId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const rows = seed.items.map((it) => ({
  id: seedUuid(it.seed_id),
  exam_code: seed.exam_code,
  skill: it.skill,
  task_type: it.task_type,
  content_json: it.content_json,
  answer_key_json: it.answer_key_json ?? null,
  status: 'approved',
  source: 'seed',
}));

let invalid = 0;
for (const [i, row] of rows.entries()) {
  const errors = validateItem(row, exam);
  if (errors.length) {
    invalid += 1;
    console.error(`✗ ${seed.items[i].seed_id}: ${errors.join('; ')}`);
  }
}
if (invalid) process.exit(1);
console.log(`✓ ${rows.length} items valid for ${exam.code}`);
if (dryRun) process.exit(0);

const { supabaseAdmin } = await import('../netlify/functions/_lib/supabase-admin.js');
const db = supabaseAdmin();
const { error } = await db.from('items').upsert(rows, { onConflict: 'id' });
if (error) throw error;
console.log(`✓ upserted ${rows.length} items`);

if (!noTts) {
  const { ensureTtsAudio } = await import('../netlify/functions/_lib/tts/index.js');
  for (const row of rows.filter((r) => r.content_json.audio)) {
    const audio = await ensureTtsAudio(
      { language: exam.contentLanguage, segments: row.content_json.audio.segments },
      { usage: { operation: 'tts_seed' } }
    );
    await db.from('items').update({ audio_path: audio.path }).eq('id', row.id);
    console.log(`  ${audio.generated ? 'generated' : 'cached   '} ${row.id} → ${audio.path}`);
  }
}
console.log('done');
