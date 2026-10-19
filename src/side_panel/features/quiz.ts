/**
 * F12 — study mode: an interactive quiz generated from the page.
 *
 * Flow: questions stream in one by one (the first is answerable while the rest
 * is still generating); each question is answered → feedback + explanation →
 * next; then a summary (score ring, grade, wrong-answer review with "follow
 * up" into the chat and "variant question" re-drills), and a flashcard deck
 * with 3D flip + self-assessment. Progress lives in TabState.quizSession, so a
 * tab switch (or panel reopen) resumes where the user left off — the card is
 * re-mounted via QUIZ_REBUILD_REQUEST, like the podcast card.
 *
 * The card is not part of the conversation history: it is not sent back to the
 * model. Light work: fast model, JSON mode.
 */

import { t } from '../../shared/i18n.js';
import { getCurrentLang } from '../../shared/i18n.js';
import { getPrompt } from '../../shared/prompts';
import { buildPageContext, splitParagraphs } from '../../shared/context-builder';
import { createQuizStreamParser, parseVariantQuestion, quizToCsv, type QuizSession } from '../../shared/quiz';
import { downloadFile } from '../../shared/download';
import type { StreamMessage } from '../../shared/protocol';
import * as state from '../state';
import { on, EVENTS } from '../events';
import { openAIChatPort } from '../../platform/ports';
import { ensurePageContent } from '../services/page-extractor';
import { setDraftText } from '../services/composer';
import { smartScrollToBottom } from '../ui/dom-helpers';
import { linkifyCitations } from '../ui/citations';
import { showToast } from '../ui/toast';

/** Page characters sent for a quiz (the opening + an even sample beyond). */
const QUIZ_CONTEXT_CHARS = 30_000;

const letter = (i: number): string => String.fromCharCode(65 + i);

let _chatArea: HTMLElement;
let _busy = false; // a quiz generation is in flight
let _variantBusy = false; // a variant-question request is in flight

/** Live view refs — the single mounted card (the active tab's session). */
interface CardView {
  card: HTMLElement;
  fill: HTMLElement;
  counter: HTMLElement;
  error: HTMLElement;
  stage: HTMLElement;
  /** Stage signature last rendered — cheap "did anything structural change?" */
  key: string;
}
let _view: CardView | null = null;

export function initQuiz({ button, chatArea }: { button: HTMLElement | null; chatArea: HTMLElement }): void {
  _chatArea = chatArea;
  button?.addEventListener('click', () => { void startQuiz(); });
  on(EVENTS.QUIZ_REBUILD_REQUEST, rebuildCard);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Persist a session; refresh the visible card when it belongs to the active tab. */
function commit(tabId: number, session: QuizSession): void {
  state.setQuizSessionForTab(tabId, session);
  if (tabId === state.getActiveTabId() && _view) renderStage(session);
}

/** Chat area was rebuilt (tab switch / panel startup / re-render): re-mount the active tab's card, if any. */
function rebuildCard(): void {
  _view = null; // the previous card DOM died with the chat area
  const tabId = state.getActiveTabId();
  if (tabId == null) return;
  const session = state.getStateForTab(tabId)?.quizSession;
  if (session) mountCard(session);
}

/** Mount (or re-mount) a card for `session` — also the restore entry used by tests. */
export function mountQuiz(session: QuizSession): void {
  mountCard(session);
}

function mountCard(session: QuizSession): void {
  if (!_chatArea) return;
  _chatArea.querySelector('.welcome-msg')?.remove();
  _chatArea.querySelector('.quiz-card')?.remove();
  const card = el('div', 'message message-ai quiz-card');
  const header = el('div', 'quiz-header');
  header.append(el('div', 'quiz-title', t('quiz.title')));
  const fill = el('div', 'quiz-progress-fill');
  const bar = el('div', 'quiz-progress');
  bar.append(fill);
  const counter = el('div', 'quiz-counter');
  header.append(bar, counter);
  const error = el('div', 'quiz-error hidden');
  const stage = el('div', 'quiz-stage');
  card.append(header, error, stage);
  _chatArea.appendChild(card);
  _view = { card, fill, counter, error, stage, key: '' };
  renderStage(session);
  smartScrollToBottom();
}

/** Refresh header (progress / counter / error line) always; re-render the stage only when its signature changed. */
function renderStage(session: QuizSession): void {
  if (!_view || !_view.card.isConnected) { _view = null; return; }
  updateHeader(session);
  const key = [
    session.phase, session.current, session.quiz.questions.length,
    session.deck.index, session.deck.order.length, session.generating ? 1 : 0,
  ].join(':');
  if (key === _view.key) return;
  _view.key = key;
  _view.stage.innerHTML = '';
  const tabId = state.getActiveTabId();
  if (tabId == null) return;
  if (session.phase === 'answering') renderQuestionStage(session, tabId);
  else if (session.phase === 'deck') renderDeckStage(session, tabId);
  else renderSummaryStage(session, tabId);
  smartScrollToBottom();
}

function updateHeader(session: QuizSession): void {
  if (!_view) return;
  const total = session.quiz.questions.length;
  const answered = session.answers.reduce<number>((n, a) => n + (a != null ? 1 : 0), 0);
  const ratio = session.phase === 'answering' && total ? answered / total : total ? 1 : 0;
  _view.fill.style.width = `${Math.round(ratio * 100)}%`;
  _view.counter.textContent = session.phase === 'answering' && total
    ? t('quiz.progress', { current: String(Math.min(session.current + 1, total)), total: String(total) })
    : '';
  if (session.error) {
    _view.error.textContent = session.error;
    _view.error.classList.remove('hidden');
  } else {
    _view.error.classList.add('hidden');
  }
}

export async function startQuiz(): Promise<void> {
  if (_busy) return;
  const tabId = state.getActiveTabId();
  if (tabId == null) return;
  _busy = true;
  const session: QuizSession = {
    quiz: { questions: [], flashcards: [] },
    answers: [],
    current: 0,
    phase: 'answering',
    deck: { index: 0, order: [], known: [] },
    generating: true,
  };
  state.setQuizSessionForTab(tabId, session);
  mountCard(session);
  try {
    const extracted = await ensurePageContent(tabId);
    if (!extracted.ok) throw extracted.error;
    const ts = state.getStateForTab(tabId);
    const paragraphs = ts?.pageParagraphs?.length ? ts.pageParagraphs : splitParagraphs(ts?.pageContent ?? '');
    if (!paragraphs.length) throw new Error(t('error.extractFailed'));
    const lang = getCurrentLang();
    const parser = createQuizStreamParser();
    await generate([
      { role: 'system', content: getPrompt('quiz.system', lang) },
      { role: 'user', content: getPrompt('quiz.user', lang, { title: ts?.pageTitle ?? '', content: buildPageContext(paragraphs, '', QUIZ_CONTEXT_CHARS).text }) },
    ], (delta) => {
      // The session may have been replaced meanwhile ("new quiz") — then stop feeding.
      if (state.getStateForTab(tabId)?.quizSession !== session) return;
      for (const q of parser.push(delta)) {
        session.quiz.questions.push(q);
        session.answers.push(null);
        commit(tabId, session);
      }
    });
    if (state.getStateForTab(tabId)?.quizSession !== session) return;
    // flush() re-parses the whole buffer: flashcards included, plus the
    // authoritative question list if the streaming scan ever lost its way.
    const full = parser.flush();
    if (full) {
      session.quiz = full;
      session.answers = full.questions.map((_, i) => session.answers[i] ?? null);
    }
    if (!session.quiz.questions.length && !session.quiz.flashcards.length) throw new Error(t('quiz.parseFailed'));
    session.generating = false;
    session.error = undefined;
    if (!session.quiz.questions.length) session.phase = 'summary'; // flashcards-only quiz
    commit(tabId, session);
  } catch (e) {
    if (state.getStateForTab(tabId)?.quizSession !== session) return;
    session.generating = false;
    const kept = session.quiz.questions.length;
    const msg = (e as Error).message ?? '';
    session.error = kept
      ? t('quiz.partialFailed', { count: String(kept) })
      : `${t('quiz.failed')}${msg ? `：${msg}` : ''}`;
    if (!kept && session.quiz.flashcards.length) session.phase = 'summary';
    commit(tabId, session);
  } finally {
    _busy = false;
  }
}

// --- Answering phase -----------------------------------------------------------

function renderQuestionStage(session: QuizSession, tabId: number): void {
  const stage = _view!.stage;
  if (!session.quiz.questions.length) {
    stage.append(spinnerLine(t('quiz.generating')));
    return;
  }
  const qi = Math.min(session.current, session.quiz.questions.length - 1);
  const q = session.quiz.questions[qi];
  const chosen = session.answers[qi];
  const answered = chosen != null;
  const box = el('div', `quiz-question${answered ? ' static' : ''}`);
  box.append(el('div', 'quiz-q', q.question));
  const feedback = el('div', 'quiz-feedback');
  const buttons = q.options.map((opt, oi) => {
    const b = el('button', 'quiz-option', `${letter(oi)}. ${opt}`);
    b.type = 'button';
    if (answered) {
      // Re-render of an already-answered question: paint the result statically
      // ('static' suppresses the pop/shake animations).
      b.disabled = true;
      if (oi === q.answer) b.classList.add('correct');
      else if (oi === chosen) b.classList.add('wrong', 'chosen');
    } else {
      b.addEventListener('click', () => {
        session.answers[qi] = oi;
        state.setQuizSessionForTab(tabId, session);
        buttons.forEach((x, xi) => {
          x.disabled = true;
          if (xi === q.answer) x.classList.add('correct');
        });
        if (oi !== q.answer) b.classList.add('wrong');
        b.classList.add('chosen');
        renderFeedback(feedback, session, tabId, qi);
        updateHeader(session);
        smartScrollToBottom();
      });
    }
    return b;
  });
  box.append(...buttons);
  stage.append(box, feedback);
  if (answered) renderFeedback(feedback, session, tabId, qi);
}

/** Explanation + (when wrong) follow-up / variant actions + the next/finish button. */
function renderFeedback(container: HTMLElement, session: QuizSession, tabId: number, qi: number): void {
  container.innerHTML = '';
  const q = session.quiz.questions[qi];
  const chosen = session.answers[qi];
  const explanation = el('div', 'quiz-explanation', q.explanation + (q.paragraph != null ? ` [#${q.paragraph}]` : ''));
  linkifyCitations(explanation);
  container.append(explanation);
  const actions = el('div', 'quiz-actions');
  if (chosen !== q.answer) {
    actions.append(ghostBtn(t('quiz.followup'), () => followupDraft(session, qi)));
    actions.append(variantBtn(session, tabId, qi));
  }
  const isLast = qi + 1 >= session.quiz.questions.length;
  const next = el('button', 'quiz-btn primary');
  next.type = 'button';
  if (isLast && session.generating) {
    next.textContent = t('quiz.generatingMore');
    next.disabled = true;
  } else {
    next.textContent = isLast ? t('quiz.finish') : t('quiz.next');
    next.addEventListener('click', () => {
      if (qi + 1 < session.quiz.questions.length) session.current = qi + 1;
      else session.phase = 'summary';
      commit(tabId, session);
    });
  }
  actions.append(next);
  container.append(actions);
}

function ghostBtn(label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'quiz-btn ghost', label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function variantBtn(session: QuizSession, tabId: number, qi: number): HTMLButtonElement {
  const b = el('button', 'quiz-btn ghost', t('quiz.variant'));
  b.type = 'button';
  b.addEventListener('click', () => {
    if (_variantBusy) return;
    _variantBusy = true;
    b.disabled = true;
    b.textContent = t('quiz.variantGenerating');
    void requestVariant(session, tabId, qi).finally(() => {
      _variantBusy = false;
      b.disabled = false;
      b.textContent = t('quiz.variant');
    });
  });
  return b;
}

/** Ask the light model for one alternative question drilling the same point; appends it to the session. */
async function requestVariant(session: QuizSession, tabId: number, qi: number): Promise<void> {
  try {
    const q = session.quiz.questions[qi];
    const lang = getCurrentLang();
    const raw = await generate([
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
    if (state.getStateForTab(tabId)?.quizSession !== session) return;
    session.quiz.questions.push(variant);
    session.answers.push(null);
    if (session.phase !== 'answering') {
      // Came from the summary's wrong-answer list — jump straight to the new question.
      session.phase = 'answering';
      session.current = session.quiz.questions.length - 1;
    }
    commit(tabId, session);
  } catch (e) {
    showToast((e as Error).message || t('quiz.variantFailed'), 3000);
  }
}

/** Pre-fill the chat input with a self-contained follow-up about this question. */
function followupDraft(session: QuizSession, qi: number): void {
  const q = session.quiz.questions[qi];
  if (!q) return;
  const chosen = session.answers[qi];
  setDraftText(getPrompt('quiz.followup', getCurrentLang(), {
    question: q.question,
    chosen: chosen == null ? '—' : `${letter(chosen)}. ${q.options[chosen]}`,
    correct: `${letter(q.answer)}. ${q.options[q.answer]}`,
    explanation: q.explanation,
  }), { focus: true });
}

// --- Summary phase -------------------------------------------------------------

function renderSummaryStage(session: QuizSession, tabId: number): void {
  const stage = _view!.stage;
  const wrap = el('div', 'quiz-summary');
  const qs = session.quiz.questions;
  const total = qs.length;
  const correct = qs.reduce((n, q, i) => n + (session.answers[i] === q.answer ? 1 : 0), 0);
  if (total) {
    wrap.append(scoreRing(correct, total));
    const ratio = correct / total;
    wrap.append(el('div', 'quiz-grade', ratio >= 0.8 ? t('quiz.grade.great') : ratio >= 0.6 ? t('quiz.grade.good') : t('quiz.grade.poor')));
  }
  const wrongIdx = qs
    .map((q, i) => (session.answers[i] != null && session.answers[i] !== q.answer ? i : -1))
    .filter((i) => i >= 0);
  if (wrongIdx.length) {
    wrap.append(el('div', 'quiz-subtitle', t('quiz.wrongReview')));
    const list = el('div', 'quiz-wrong-list');
    for (const i of wrongIdx) list.append(wrongItem(session, tabId, i));
    wrap.append(list);
  }
  const actions = el('div', 'quiz-actions quiz-main-actions');
  if (wrongIdx.length) {
    actions.append(ghostBtn(t('quiz.retakeWrong'), () => {
      session.quiz = { ...session.quiz, questions: wrongIdx.map((i) => qs[i]) };
      session.answers = wrongIdx.map(() => null);
      session.current = 0;
      session.phase = 'answering';
      session.error = undefined;
      commit(tabId, session);
    }));
  }
  if (session.quiz.flashcards.length) {
    actions.append(ghostBtn(t('quiz.deck'), () => {
      session.phase = 'deck';
      session.deck = { index: 0, order: session.quiz.flashcards.map((_, i) => i), known: session.quiz.flashcards.map(() => null) };
      commit(tabId, session);
    }));
  }
  actions.append(ghostBtn(t('quiz.again'), () => { void startQuiz(); }));
  actions.append(ghostBtn(t('quiz.exportAnki'), () => {
    downloadFile(quizToCsv(session.quiz), `${t('app.fullName')}_quiz_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
    showToast(t('quiz.exported'), 2000);
  }));
  wrap.append(actions);
  stage.append(wrap);
  if (total && correct === total) celebrate();
}

function wrongItem(session: QuizSession, tabId: number, i: number): HTMLElement {
  const q = session.quiz.questions[i];
  const chosen = session.answers[i]!;
  const item = el('div', 'quiz-wrong-item');
  item.append(el('div', 'quiz-q', q.question));
  item.append(el('div', 'quiz-answer-line', t('quiz.answerLine', {
    chosen: `${letter(chosen)}. ${q.options[chosen]}`,
    correct: `${letter(q.answer)}. ${q.options[q.answer]}`,
  })));
  const explanation = el('div', 'quiz-explanation', q.explanation + (q.paragraph != null ? ` [#${q.paragraph}]` : ''));
  linkifyCitations(explanation);
  const actions = el('div', 'quiz-actions');
  actions.append(ghostBtn(t('quiz.followup'), () => followupDraft(session, i)));
  actions.append(variantBtn(session, tabId, i));
  item.append(explanation, actions);
  return item;
}

function scoreRing(correct: number, total: number): HTMLElement {
  const R = 40;
  const C = 2 * Math.PI * R;
  const wrap = el('div', 'quiz-ring');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 96 96');
  svg.setAttribute('width', '96');
  svg.setAttribute('height', '96');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', t('quiz.score', { correct: String(correct), total: String(total) }));
  svg.innerHTML = `<circle class="ring-track" cx="48" cy="48" r="${R}" fill="none" stroke-width="8"></circle>` +
    `<circle class="ring-fill" cx="48" cy="48" r="${R}" fill="none" stroke-width="8" stroke-dasharray="${C}" stroke-dashoffset="${C}"></circle>`;
  const fillCircle = svg.querySelector('.ring-fill') as SVGCircleElement | null;
  const target = String(C * (1 - correct / total));
  // Animate the arc from empty → score ratio on the next frame.
  if (fillCircle) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { fillCircle.style.strokeDashoffset = target; });
    else fillCircle.style.strokeDashoffset = target;
  }
  wrap.append(svg, el('div', 'quiz-ring-text', `${correct}/${total}`));
  return wrap;
}

/** A short burst of confetti over the panel — full marks only, reduced-motion aware. */
function celebrate(): void {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'quiz-confetti';
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth || 360;
  const h = window.innerHeight || 600;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return; }
  ctx.scale(dpr, dpr);
  const colors = ['#3a9d5d', '#4285f4', '#f4b400', '#d0453b', '#9067c6'];
  const pieces = Array.from({ length: 42 }, () => ({
    x: Math.random() * w,
    y: -20 - Math.random() * h * 0.3,
    w: 5 + Math.random() * 5,
    h: 8 + Math.random() * 6,
    vy: 2 + Math.random() * 2.5,
    vx: -1 + Math.random() * 2,
    rot: Math.random() * Math.PI,
    vr: -0.1 + Math.random() * 0.2,
    color: colors[(Math.random() * colors.length) | 0],
  }));
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const tick = (now: number): void => {
    ctx.clearRect(0, 0, w, h);
    for (const p of pieces) {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (now - started < 1600 && typeof requestAnimationFrame === 'function') requestAnimationFrame(tick);
    else canvas.remove();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tick);
  else canvas.remove();
}

// --- Deck phase ----------------------------------------------------------------

function renderDeckStage(session: QuizSession, tabId: number): void {
  const stage = _view!.stage;
  const deck = session.deck;
  const cards = session.quiz.flashcards;
  if (deck.index >= deck.order.length) {
    // Run finished: stats + what next.
    const unknown = deck.order.filter((i) => deck.known[i] !== true).length;
    const wrap = el('div', 'quiz-summary');
    wrap.append(el('div', 'quiz-grade', t('quiz.deckResult', {
      known: String(deck.order.length - unknown),
      unknown: String(unknown),
    })));
    const actions = el('div', 'quiz-actions');
    if (unknown > 0) {
      actions.append(ghostBtn(t('quiz.deckAgain'), () => {
        const order = deck.order.filter((i) => deck.known[i] !== true);
        order.forEach((i) => { deck.known[i] = null; });
        deck.order = order;
        deck.index = 0;
        commit(tabId, session);
      }));
    }
    actions.append(ghostBtn(t('quiz.backToSummary'), () => {
      session.phase = 'summary';
      commit(tabId, session);
    }));
    wrap.append(actions);
    stage.append(wrap);
    return;
  }
  const cardIndex = deck.order[deck.index];
  const data = cards[cardIndex];
  const wrap = el('div', 'quiz-deck-stage');
  wrap.append(el('div', 'quiz-deck-count', t('quiz.deckCount', { current: String(deck.index + 1), total: String(deck.order.length) })));
  const scene = el('div', 'flashcard-scene');
  scene.title = t('quiz.flip');
  const flipper = el('div', 'flashcard3d');
  flipper.append(el('div', 'flashcard-face front', data.front), el('div', 'flashcard-face back', data.back));
  scene.append(flipper);
  const knownBtn = el('button', 'quiz-btn good', t('quiz.deckKnown')) as HTMLButtonElement;
  const unknownBtn = el('button', 'quiz-btn bad', t('quiz.deckUnknown')) as HTMLButtonElement;
  knownBtn.type = 'button';
  unknownBtn.type = 'button';
  // Grade buttons unlock only after the first flip — check the back before judging.
  knownBtn.disabled = true;
  unknownBtn.disabled = true;
  knownBtn.addEventListener('click', () => { deck.known[cardIndex] = true; deck.index++; commit(tabId, session); });
  unknownBtn.addEventListener('click', () => { deck.known[cardIndex] = false; deck.index++; commit(tabId, session); });
  scene.addEventListener('click', () => {
    scene.classList.toggle('flipped');
    knownBtn.disabled = false;
    unknownBtn.disabled = false;
  });
  const actions = el('div', 'quiz-actions quiz-deck-actions');
  actions.append(unknownBtn, knownBtn);
  wrap.append(scene, el('div', 'quiz-deck-hint', t('quiz.flip')), actions);
  stage.append(wrap);
}

// --- Generation ----------------------------------------------------------------

function spinnerLine(text: string): HTMLElement {
  const wrap = el('div', 'quiz-status');
  wrap.append(el('div', 'quiz-spinner'), el('span', '', text));
  return wrap;
}

/** One JSON-mode request on the chat port ('light' → the fast model if configured). */
function generate(messages: { role: 'system' | 'user'; content: string }[], onDelta?: (delta: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const port = openAIChatPort();
    let text = '';
    port.onMessage.addListener((msg: StreamMessage) => {
      if (msg.type === 'chunk') { text += msg.content; onDelta?.(msg.content); }
      else if (msg.type === 'done') { port.disconnect(); resolve(text); }
      else if (msg.type === 'error') { port.disconnect(); reject(new Error(msg.errorKey ? t(msg.errorKey) : (msg.error ?? ''))); }
    });
    port.onDisconnect.addListener(() => reject(new Error(t('error.apiFailed'))));
    port.postMessage({ type: 'chat', messages, purpose: 'light', response_format: { type: 'json_object' }, temperature: 0.5 });
  });
}
