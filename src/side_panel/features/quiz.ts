/**
 * F12 — study mode: "Quiz" generates single-choice questions (with the
 * source paragraph and an explanation) and flashcards from the page, shown
 * as an interactive card in the chat; flashcards and questions export as an
 * Anki-importable CSV. Light work: fast model, JSON mode.
 *
 * The card is not part of the conversation history (like the podcast card):
 * it is not sent back to the model and is not restored on tab switch.
 */

import { t } from '../../shared/i18n.js';
import { getCurrentLang } from '../../shared/i18n.js';
import { getPrompt } from '../../shared/prompts';
import { buildPageContext, splitParagraphs } from '../../shared/context-builder';
import { parseQuiz, quizToCsv, type Quiz } from '../../shared/quiz';
import { downloadFile } from '../../shared/download';
import type { StreamMessage } from '../../shared/protocol';
import * as state from '../state';
import { openAIChatPort } from '../../platform/ports';
import { ensurePageContent } from '../services/page-extractor';
import { smartScrollToBottom } from '../ui/dom-helpers';
import { linkifyCitations } from '../ui/citations';
import { showToast } from '../ui/toast';

/** Page characters sent for a quiz (the opening + an even sample beyond). */
const QUIZ_CONTEXT_CHARS = 30_000;

let _chatArea: HTMLElement;
let _busy = false;

export function initQuiz({ button, chatArea }: { button: HTMLElement | null; chatArea: HTMLElement }): void {
  _chatArea = chatArea;
  button?.addEventListener('click', () => { void startQuiz(); });
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export async function startQuiz(): Promise<void> {
  if (_busy) return;
  const tabId = state.getActiveTabId();
  if (tabId == null) return;
  _busy = true;
  const card = el('div', 'message message-ai quiz-card');
  card.append(el('div', 'quiz-title', t('quiz.title')), el('div', 'quiz-status', t('quiz.generating')));
  _chatArea.querySelector('.welcome-msg')?.remove();
  _chatArea.appendChild(card);
  smartScrollToBottom();

  try {
    const extracted = await ensurePageContent(tabId);
    if (!extracted.ok) throw extracted.error;
    const ts = state.getStateForTab(tabId);
    const paragraphs = ts?.pageParagraphs?.length ? ts.pageParagraphs : splitParagraphs(ts?.pageContent ?? '');
    if (!paragraphs.length) throw new Error(t('error.extractFailed'));
    const lang = getCurrentLang();
    const raw = await generate([
      { role: 'system', content: getPrompt('quiz.system', lang) },
      { role: 'user', content: getPrompt('quiz.user', lang, { title: ts?.pageTitle ?? '', content: buildPageContext(paragraphs, '', QUIZ_CONTEXT_CHARS).text }) },
    ]);
    const quiz = parseQuiz(raw);
    if (!quiz) throw new Error(t('quiz.parseFailed'));
    renderQuiz(card, quiz);
  } catch (e) {
    card.querySelector('.quiz-status')!.textContent = `${t('quiz.failed')}${(e as Error).message ? `：${(e as Error).message}` : ''}`;
  } finally {
    _busy = false;
  }
}

/** One JSON-mode request on the chat port ('light' → the fast model if configured). */
function generate(messages: { role: 'system' | 'user'; content: string }[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const port = openAIChatPort();
    let text = '';
    port.onMessage.addListener((msg: StreamMessage) => {
      if (msg.type === 'chunk') text += msg.content;
      else if (msg.type === 'done') { port.disconnect(); resolve(text); }
      else if (msg.type === 'error') { port.disconnect(); reject(new Error(msg.errorKey ? t(msg.errorKey) : (msg.error ?? ''))); }
    });
    port.onDisconnect.addListener(() => reject(new Error(t('error.apiFailed'))));
    port.postMessage({ type: 'chat', messages, purpose: 'light', response_format: { type: 'json_object' }, temperature: 0.5 });
  });
}

export function renderQuiz(card: HTMLElement, quiz: Quiz): void {
  card.querySelector('.quiz-status')?.remove();
  let answered = 0;
  let correct = 0;
  const score = el('div', 'quiz-score');
  const updateScore = () => { score.textContent = t('quiz.score', { correct: String(correct), total: String(quiz.questions.length) }); };

  quiz.questions.forEach((q, qi) => {
    const box = el('div', 'quiz-question');
    box.appendChild(el('div', 'quiz-q', `${qi + 1}. ${q.question}`));
    const explanation = el('div', 'quiz-explanation hidden', q.explanation + (q.paragraph != null ? ` [#${q.paragraph}]` : ''));
    linkifyCitations(explanation);
    const buttons = q.options.map((opt, oi) => {
      const b = el('button', 'quiz-option', `${String.fromCharCode(65 + oi)}. ${opt}`);
      b.type = 'button';
      b.addEventListener('click', () => {
        buttons.forEach((x, xi) => { x.disabled = true; if (xi === q.answer) x.classList.add('correct'); });
        if (oi !== q.answer) b.classList.add('wrong'); else correct++;
        answered++;
        explanation.classList.remove('hidden');
        updateScore();
        if (answered === quiz.questions.length) score.classList.add('final');
      });
      return b;
    });
    box.append(...buttons, explanation);
    card.appendChild(box);
  });
  if (quiz.questions.length) { updateScore(); card.appendChild(score); }

  if (quiz.flashcards.length) {
    card.appendChild(el('div', 'quiz-subtitle', t('quiz.flashcards')));
    const deck = el('div', 'quiz-deck');
    for (const c of quiz.flashcards) {
      const fc = el('button', 'flashcard', c.front);
      fc.type = 'button';
      fc.title = t('quiz.flip');
      fc.addEventListener('click', () => {
        const flipped = fc.classList.toggle('flipped');
        fc.textContent = flipped ? c.back : c.front;
      });
      deck.appendChild(fc);
    }
    card.appendChild(deck);
  }

  const exportBtn = el('button', 'quiz-export', t('quiz.exportAnki'));
  exportBtn.type = 'button';
  exportBtn.addEventListener('click', () => {
    downloadFile(quizToCsv(quiz), `${t('app.fullName')}_quiz_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
    showToast(t('quiz.exported'), 2000);
  });
  card.appendChild(exportBtn);
  smartScrollToBottom();
}
