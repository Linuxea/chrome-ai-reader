/**
 * F12 — study mode: quiz questions + flashcards generated from the page.
 * Pure parsing / export (the model's JSON is untrusted and often slightly off).
 */

import { stripMarkdownFence, extractJsonObject, repairLLMJson } from './json-repair';

export interface QuizQuestion {
  question: string;
  options: string[];
  /** Index into options. */
  answer: number;
  explanation: string;
  /** Source paragraph label [#N], when given. */
  paragraph?: number;
}

export interface Flashcard { front: string; back: string }

export interface Quiz {
  questions: QuizQuestion[];
  flashcards: Flashcard[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Parse and validate the model's quiz JSON; drops malformed items. Null when nothing usable. */
export function parseQuiz(raw: string): Quiz | null {
  const json = extractJsonObject(stripMarkdownFence(raw), 'questions') ?? extractJsonObject(raw);
  if (!json) return null;
  let data: { questions?: unknown; flashcards?: unknown };
  try { data = JSON.parse(json); } catch {
    try { data = JSON.parse(repairLLMJson(json)); } catch { return null; }
  }
  const questions: QuizQuestion[] = [];
  for (const q of Array.isArray(data.questions) ? data.questions : []) {
    const item = q as Record<string, unknown>;
    const options = Array.isArray(item.options) ? item.options.map(str).filter(Boolean) : [];
    const answer = Number(item.answer);
    if (!str(item.question) || options.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= options.length) continue;
    const paragraph = Number(item.paragraph);
    questions.push({
      question: str(item.question),
      options,
      answer,
      explanation: str(item.explanation),
      ...(Number.isInteger(paragraph) && paragraph >= 0 ? { paragraph } : {}),
    });
  }
  const flashcards: Flashcard[] = [];
  for (const c of Array.isArray(data.flashcards) ? data.flashcards : []) {
    const card = c as Record<string, unknown>;
    if (str(card.front) && str(card.back)) flashcards.push({ front: str(card.front), back: str(card.back) });
  }
  return questions.length || flashcards.length ? { questions, flashcards } : null;
}

const csvCell = (s: string): string => `"${s.replace(/"/g, '""')}"`;

/**
 * Anki-importable CSV (front,back): every flashcard, plus each question with
 * its options on the front and the answer + explanation on the back.
 */
export function quizToCsv(quiz: Quiz): string {
  const rows: [string, string][] = quiz.flashcards.map((c) => [c.front, c.back]);
  for (const q of quiz.questions) {
    const letters = q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n');
    const back = `${String.fromCharCode(65 + q.answer)}. ${q.options[q.answer]}${q.explanation ? `\n\n${q.explanation}` : ''}`;
    rows.push([`${q.question}\n\n${letters}`, back]);
  }
  return rows.map(([f, b]) => `${csvCell(f)},${csvCell(b)}`).join('\n') + '\n';
}
