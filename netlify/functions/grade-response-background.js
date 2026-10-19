// Background function (runs up to 15 min; the caller gets 202 immediately).
// POST /.netlify/functions/grade-response-background  { responseId }
// No auth needed: it only grades responses already accepted (and rate-limited)
// by attempt-answer / attempt-audio, and grading the same one twice is a no-op.
import { gradeResponse } from './_lib/grade-response.js';

export default async (req) => {
  if (req.method !== 'POST') return;
  let body;
  try {
    body = await req.json();
  } catch {
    return;
  }
  if (typeof body?.responseId !== 'string' || !/^[0-9a-f-]{36}$/.test(body.responseId)) return;
  const result = await gradeResponse(body.responseId);
  console.log('[grade-response]', body.responseId, JSON.stringify(result));
};
