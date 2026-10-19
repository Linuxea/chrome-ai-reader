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

/** Self-assessment state of the flashcard deck run (`QuizSession.deck`). */
export interface QuizDeckState {
  /** Index into `order` of the card currently shown. */
  index: number;
  /** Flashcards in this run (indexes into `quiz.flashcards`); empty = not started. */
  order: number[];
  /** Per flashcard: true = known, false = not yet, null = unrated. */
  known: (boolean | null)[];
}

export type QuizPhase = 'answering' | 'deck' | 'summary';

/** An in-progress quiz, persisted in TabState so it survives tab switches. */
export interface QuizSession {
  quiz: Quiz;
  /** Chosen option index per question (null = unanswered). */
  answers: (number | null)[];
  /** Index of the question shown in the answering phase. */
  current: number;
  phase: QuizPhase;
  deck: QuizDeckState;
  /** True while questions are still streaming in (never persisted as true). */
  generating?: boolean;
  /** Terminal generation error shown under the header ('' once answered). */
  error?: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Validate and normalize one raw question object; null when malformed. */
export function parseQuestion(item: Record<string, unknown> | null | undefined): QuizQuestion | null {
  if (!item) return null;
  const options = Array.isArray(item.options) ? item.options.map(str).filter(Boolean) : [];
  const answer = Number(item.answer);
  if (!str(item.question) || options.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= options.length) return null;
  const paragraph = Number(item.paragraph);
  return {
    question: str(item.question),
    options,
    answer,
    explanation: str(item.explanation),
    ...(Number.isInteger(paragraph) && paragraph >= 0 ? { paragraph } : {}),
  };
}

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
    const question = parseQuestion(q as Record<string, unknown>);
    if (question) questions.push(question);
  }
  const flashcards: Flashcard[] = [];
  for (const c of Array.isArray(data.flashcards) ? data.flashcards : []) {
    const card = c as Record<string, unknown>;
    if (str(card.front) && str(card.back)) flashcards.push({ front: str(card.front), back: str(card.back) });
  }
  return questions.length || flashcards.length ? { questions, flashcards } : null;
}

/**
 * Incremental parser for the streamed quiz JSON. The model emits
 * {"questions":[…],"flashcards":[…]}; `push()` returns each question the
 * moment its object closes (validated), so the first question can be answered
 * while the rest is still streaming. `flush()` re-parses the whole buffer and
 * returns the authoritative Quiz — flashcards included, and a safety net if
 * the streaming scan ever lost its way.
 */
export function createQuizStreamParser(): { push(delta: string): QuizQuestion[]; flush(): Quiz | null } {
  let buf = '';
  let pos = 0; // scan cursor (persists across pushes)
  let state: 'seek' | 'array' | 'done' = 'seek';
  let inString = false;
  let escaped = false;
  let depth = 0; // brace depth of the current array element
  let elemStart = -1;

  const scan = (): QuizQuestion[] => {
    const out: QuizQuestion[] = [];
    if (state === 'seek') {
      const key = buf.indexOf('"questions"', pos);
      if (key === -1) {
        // The key may straddle the chunk boundary — only advance to where a
        // partial '"questions"' (11 chars) could still begin.
        pos = Math.max(pos, buf.length - 10);
        return out;
      }
      const open = buf.indexOf('[', key);
      // Keep pos ON the key until the '[' arrives — advancing past it would
      // make the next indexOf miss the (already-seen) key forever.
      if (open === -1) { pos = key; return out; }
      pos = open + 1;
      state = 'array';
    }
    for (; pos < buf.length; pos++) {
      const ch = buf[pos];
      if (escaped) { escaped = false; continue; }
      if (inString) {
        if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (depth === 0) {
        if (ch === '{') { depth = 1; elemStart = pos; }
        else if (ch === ']') { state = 'done'; pos++; break; }
        // commas / whitespace between elements are skipped
      } else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            const q = parseQuestion(JSON.parse(repairLLMJson(buf.slice(elemStart, pos + 1))));
            if (q) out.push(q);
          } catch { /* malformed element — drop */ }
          elemStart = -1;
        }
      }
    }
    return out;
  };

  return {
    push(delta: string): QuizQuestion[] { buf += delta; return scan(); },
    flush(): Quiz | null { return parseQuiz(buf); },
  };
}

/** Parse the answer of the variant-question prompt: {"question":{…}} or a bare question object. */
export function parseVariantQuestion(raw: string): QuizQuestion | null {
  const stripped = stripMarkdownFence(raw);
  const json = extractJsonObject(stripped, 'question') ?? extractJsonObject(stripped);
  if (!json) return null;
  let data: Record<string, unknown>;
  try { data = JSON.parse(json) as Record<string, unknown>; } catch {
    try { data = JSON.parse(repairLLMJson(json)) as Record<string, unknown>; } catch { return null; }
  }
  const item = data.question && typeof data.question === 'object' && !Array.isArray(data.question)
    ? data.question as Record<string, unknown>
    : data;
  return parseQuestion(item);
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
