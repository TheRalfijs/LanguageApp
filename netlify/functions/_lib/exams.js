// Exam configs available to functions. Add new packs here (static imports so
// the bundler includes them).
import lvB1 from '../../../config/exams/lv-b1.json' with { type: 'json' };
import { HttpError } from './http.js';

const EXAMS = { [lvB1.code]: lvB1 };

export function getExam(code) {
  const exam = EXAMS[code];
  if (!exam) throw new HttpError(400, 'unknown_exam');
  return exam;
}
