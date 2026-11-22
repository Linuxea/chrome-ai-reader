/**
 * Quiz controller — the protocol half of the legacy `features/quiz.ts`,
 * ported to write into the quiz store instead of the DOM.
 *
 * Kept verbatim (hard-won semantics):
 * - Questions stream through `createQuizStreamParser`: each question is
 *   committed the moment its object closes, so the first is answerable while
 *   the rest still streams; `flush()` re-parses the whole buffer as the
 *   authoritative result (flashcards included).
 * - JSON mode on the ai-chat port (purpose 'chat', temperature 0.5) — the
 *   card is NOT part of the conversation and never sets the tab's
 *   `isGenerating` (the chat Stop stays a chat stop).
 * - Failure keeps partial questions (`quiz.partialFailed`); a stream that
 *   produced nothing is a hard error; a flashcards-only quiz skips straight
 *   to the summary.
 * - A variant question drills the same point from another angle and, when
 *   requested from the summary, jumps straight to the new question.
 *
 * New (no legacy equivalent): `stopQuiz()` — a stop before anything arrived
 * cancels the card entirely; a stop with kept questions degrades exactly
 * like a mid-stream disconnect.
 */
import { t, getCurrentLang } from '@/shared/i18n.js';
import { getPrompt } from '@/shared/prompts';
import { buildPageContext, splitParagraphs } from '@/shared/context-builder';
import { createQuizStreamParser, parseVariantQuestion, quizToCsv, type QuizSession } from '@/shared/quiz';
import { downloadFile } from '@/shared/download';
import type { ChatMessage } from '@/shared/types';
import type { AIChatRequest, StreamMessage } from '@/shared/protocol';
import { openAIChatPort } from '@/platform/ports';
import { ensurePageContent } from '@/panel/lib/page-extractor';
import * as core from '@/panel/state';
import { useQuizStore } from '@/panel/stores/quiz-store';
import { useComposerStore } from '@/panel/stores/composer-store';
import { useUIStore } from '@/panel/stores/ui-store';

/** Page characters sent for a quiz (the opening + an even sample beyond). */
const QUIZ_CONTEXT_CHARS = 30_000;

/** Option letter for an index (A, B, C, …). */
export const letter = (i: number): string => String.fromCharCode(65 + i);

/** Indexes of questions answered wrongly (unanswered ones are not "wrong"). */
export function wrongAnswerIndexes(session: QuizSession): number[] {
  return session.quiz.questions
    .map((q, i) => (session.answers[i] != null && session.answers[i] !== q.answer ? i : -1))
    .filter(i => i >= 0);
}

// --- In-flight bookkeeping -----------------------------------------------------

/** The user stopped before anything usable arrived. */
class QuizStoppedError extends Error {
  constructor() { super(t('ai.stopped')); }
}

interface QuizRun { abort: () => void }

/** Open generations by run key (`${tabId}:quiz` / `${tabId}:variant`). */
const _runs = new Map<string, QuizRun>();

/** Stops requested before the port opened (page extraction still running). */
const _stopRequests = new Set<number>();

/** Generation tokens per tab — bumped by every startQuiz so a replaced
 *  session's in-flight stream stops feeding (object identity is useless with
 *  immutable store updates). */
let _genSeq = 0;
const _generations = new Map<number, number>();

function session(tabId: number): QuizSession | undefined {
  return useQuizStore.getState().sessions[tabId];
}

function commit(tabId: number, next: QuizSession): void {
  useQuizStore.getState().commit(tabId, next);
}

/**
 * One JSON-mode request on the chat port. `runKey` names the abort slot, so
 * a variant request can never hijack the main quiz stream's stop.
 */
function generate(runKey: string, messages: ChatMessage[], onDelta?: (delta: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const port = openAIChatPort();
    let text = '';
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      _runs.delete(runKey);
      try { port.disconnect(); } catch { /* already disconnected */ }
      fn();
    };
    const run: QuizRun = { abort: () => finish(() => reject(new QuizStoppedError())) };
    _runs.set(runKey, run);

    port.onMessage.addListener((msg: StreamMessage) => {
      if (settled) return;
      if (msg.type === 'chunk') {
        text += msg.content;
        onDelta?.(msg.content);
      } else if (msg.type === 'done') {
        finish(() => resolve(text));
      } else if (msg.type === 'error') {
        finish(() => reject(new Error(msg.errorKey ? t(msg.errorKey) : (msg.error ?? ''))));
      }
    });
    // Fires only when the worker's end goes away — never for our own disconnect().
    port.onDisconnect.addListener(() => finish(() => reject(new Error(t('error.apiFailed')))));

    const req: AIChatRequest = {
      type: 'chat',
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.5,
    };
    port.postMessage(req);
  });
}

// --- Start / stop --------------------------------------------------------------

/**
 * Start (or restart) a quiz for the ACTIVE tab. Rejected while a chat answer
 * is streaming or a quiz generation is already in flight for the tab.
 */
export async function startQuiz(): Promise<void> {
  const tabId = core.getActiveTabId();
  if (tabId == null) return;
  if (core.getStateForTab(tabId)?.isGenerating) return; // a chat answer is streaming
  if (session(tabId)?.generating) return; // a quiz is already generating for this tab

  const token = ++_genSeq;
  _generations.set(tabId, token);
  const isLive = (): boolean => _generations.get(tabId) === token;

  useQuizStore.getState().begin(tabId); // fresh generating session, persisted

  try {
    const extracted = await ensurePageContent(tabId);
    // A Stop pressed while the page was being extracted: cancel quietly.
    if (_stopRequests.delete(tabId) || !isLive()) {
      useQuizStore.getState().discard(tabId);
      useUIStore.getState().pushToast(t('ai.stopped'));
      return;
    }
    if (!extracted.ok) throw extracted.error;

    const ts = core.getStateForTab(tabId);
    const paragraphs = ts?.pageParagraphs?.length ? ts.pageParagraphs : splitParagraphs(ts?.pageContent ?? '');
    if (!paragraphs.length) throw new Error(t('error.extractFailed'));

    const lang = getCurrentLang();
    const parser = createQuizStreamParser();
    await generate(`${tabId}:quiz`, [
      { role: 'system', content: getPrompt('quiz.system', lang) },
      { role: 'user', content: getPrompt('quiz.user', lang, { title: ts?.pageTitle ?? '', content: buildPageContext(paragraphs, '', QUIZ_CONTEXT_CHARS).text }) },
    ], (delta) => {
      if (!isLive()) return; // the session was replaced meanwhile
      let cur = session(tabId);
      if (!cur?.generating) return;
      // Commit each question the moment its object closes — the first is
      // answerable while the rest is still streaming.
      for (const q of parser.push(delta)) {
        cur = {
          ...cur,
          quiz: { ...cur.quiz, questions: [...cur.quiz.questions, q] },
          answers: [...cur.answers, null],
        };
        commit(tabId, cur);
      }
    });
    if (!isLive()) return;

    // flush() re-parses the whole buffer: flashcards included, plus the
    // authoritative question list if the streaming scan ever lost its way.
    const full = parser.flush();
    const cur = session(tabId);
    if (!cur) return;
    const next: QuizSession = { ...cur };
    if (full) {
      next.quiz = full;
      next.answers = full.questions.map((_, i) => cur.answers[i] ?? null);
    }
    if (!next.quiz.questions.length && !next.quiz.flashcards.length) throw new Error(t('quiz.parseFailed'));
    next.generating = false;
    next.error = undefined;
    if (!next.quiz.questions.length) next.phase = 'summary'; // flashcards-only quiz
    commit(tabId, next);
  } catch (e) {
    if (!isLive()) return;
    const cur = session(tabId);
    if (!cur) return;
    const stopped = e instanceof QuizStoppedError;
    const kept = cur.quiz.questions.length;
    if (stopped && !kept) {
      // Cancelled before anything usable arrived: the card just goes away.
      useQuizStore.getState().discard(tabId);
      useUIStore.getState().pushToast(t('ai.stopped'));
      return;
    }
    const msg = e instanceof Error ? (e.message ?? '') : '';
    const failed: QuizSession = {
      ...cur,
      generating: false,
      error: kept
        ? t('quiz.partialFailed', { count: String(kept) })
        : `${t('quiz.failed')}${msg ? `：${msg}` : ''}`,
    };
    if (!kept && cur.quiz.flashcards.length) failed.phase = 'summary';
    commit(tabId, failed);
  }
}

/**
 * Abort the ACTIVE tab's quiz stream. Before anything arrived the card is
 * dropped; with questions already kept it degrades like a mid-stream
 * disconnect (`quiz.partialFailed`).
 */
export function stopQuiz(): void {
  const tabId = core.getActiveTabId();
  if (tabId == null) return;
  const run = _runs.get(`${tabId}:quiz`);
  if (run) {
    run.abort();
    return;
  }
  // Port not open yet (page extraction): consume it when generation starts.
  if (session(tabId)?.generating) _stopRequests.add(tabId);
}

// --- Answering phase -----------------------------------------------------------

/** Record the chosen option (question boundaries persist immediately). */
export function answerQuestion(tabId: number, questionIndex: number, optionIndex: number): void {
  const cur = session(tabId);
  if (!cur || cur.answers[questionIndex] != null) return; // already answered
  const answers = cur.answers.slice();
  answers[questionIndex] = optionIndex;
  commit(tabId, { ...cur, answers });
}

/** Next question, or finish into the summary. */
export function gotoNextQuestion(tabId: number): void {
  const cur = session(tabId);
  if (!cur || cur.phase !== 'answering') return;
  const qi = Math.min(cur.current, Math.max(cur.quiz.questions.length - 1, 0));
  if (qi + 1 < cur.quiz.questions.length) commit(tabId, { ...cur, current: qi + 1 });
  else commit(tabId, { ...cur, phase: 'summary' });
}

/** Re-drill only the wrongly answered questions. */
export function retakeWrongQuestions(tabId: number): void {
  const cur = session(tabId);
  if (!cur) return;
  const wrong = wrongAnswerIndexes(cur);
  if (!wrong.length) return;
  commit(tabId, {
    ...cur,
    quiz: { ...cur.quiz, questions: wrong.map(i => cur.quiz.questions[i]!) },
    answers: wrong.map(() => null),
    current: 0,
    phase: 'answering',
    error: undefined,
  });
}

/** Pre-fill the chat input with a self-contained follow-up about this question. */
export function followupDraft(tabId: number, questionIndex: number): void {
  const cur = session(tabId);
  const q = cur?.quiz.questions[questionIndex];
  if (!cur || !q) return;
  const chosen = cur.answers[questionIndex];
  useComposerStore.getState().setDraftText(getPrompt('quiz.followup', getCurrentLang(), {
    question: q.question,
    chosen: chosen == null ? '—' : `${letter(chosen)}. ${q.options[chosen]}`,
    correct: `${letter(q.answer)}. ${q.options[q.answer]}`,
    explanation: q.explanation,
  }));
}

/** Ask the light model for one alternative question drilling the same point; appends it. */
export async function requestVariant(tabId: number, questionIndex: number): Promise<void> {
  if (useQuizStore.getState().variantBusy[tabId]) return;
  const q = session(tabId)?.quiz.questions[questionIndex];
  if (!q) return;
  useQuizStore.getState().setVariantBusy(tabId, true);
  try {
    const lang = getCurrentLang();
    const raw = await generate(`${tabId}:variant`, [
      { role: 'system', content: getPrompt('quiz.variant.system', lang) },
      { role: 'user', content: getPrompt('quiz.variant.user', lang, {
        question: q.question,
        options: q.options.map((o, i) => `${letter(i)}. ${o}`).join('\n'),
        answer: `${letter(q.answer)}. ${q.options[q.answer]}`,
        explanation: q.explanation,
      }) },
    ]);
    const variant = parseVariantQuestion(raw);
    if (!variant) throw new Error(t('quiz.variantFailed'));
    const live = session(tabId);
    if (!live) return;
    const next: QuizSession = {
      ...live,
      quiz: { ...live.quiz, questions: [...live.quiz.questions, variant] },
      answers: [...live.answers, null],
    };
    if (live.phase !== 'answering') {
      // Came from the summary's wrong-answer list — jump straight to the new question.
      next.phase = 'answering';
      next.current = next.quiz.questions.length - 1;
    }
    commit(tabId, next);
  } catch (e) {
    useUIStore.getState().pushToast(e instanceof Error && e.message ? e.message : t('quiz.variantFailed'), 'error');
  } finally {
    useQuizStore.getState().setVariantBusy(tabId, false);
  }
}

// --- Summary / deck ------------------------------------------------------------

/** Start the flashcard run (full deck, nothing rated yet). */
export function startDeck(tabId: number): void {
  const cur = session(tabId);
  if (!cur || !cur.quiz.flashcards.length) return;
  commit(tabId, {
    ...cur,
    phase: 'deck',
    deck: { index: 0, order: cur.quiz.flashcards.map((_, i) => i), known: cur.quiz.flashcards.map(() => null) },
  });
  useQuizStore.getState().setFlipped(tabId, false);
}

/** Self-assess the card currently shown and advance the deck. */
export function gradeCard(tabId: number, known: boolean): void {
  const cur = session(tabId);
  if (!cur || cur.phase !== 'deck') return;
  const cardIndex = cur.deck.order[cur.deck.index];
  if (cardIndex == null) return;
  const knownArr = cur.deck.known.slice();
  knownArr[cardIndex] = known;
  commit(tabId, { ...cur, deck: { ...cur.deck, known: knownArr, index: cur.deck.index + 1 } });
  useQuizStore.getState().setFlipped(tabId, false); // next card starts face-down
}

/** Re-run only the cards not yet rated known. */
export function drillUnknownCards(tabId: number): void {
  const cur = session(tabId);
  if (!cur) return;
  const order = cur.deck.order.filter(i => cur.deck.known[i] !== true);
  if (!order.length) return;
  const known = cur.deck.known.slice();
  order.forEach(i => { known[i] = null; });
  commit(tabId, { ...cur, deck: { index: 0, order, known } });
  useQuizStore.getState().setFlipped(tabId, false);
}

/** Leave the deck run back to the results. */
export function backToSummary(tabId: number): void {
  const cur = session(tabId);
  if (!cur) return;
  commit(tabId, { ...cur, phase: 'summary' });
}

/** Anki-importable CSV of questions + flashcards. */
export function exportCsv(tabId: number): void {
  const cur = session(tabId);
  if (!cur) return;
  downloadFile(quizToCsv(cur.quiz), `${t('app.fullName')}_quiz_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
  useUIStore.getState().pushToast(t('quiz.exported'), 'success');
}
