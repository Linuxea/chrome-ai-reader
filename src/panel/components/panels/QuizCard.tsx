/**
 * QuizCard — F12 study mode, the React port of `features/quiz.ts`'s card.
 * Rendered under the MessageList; returns null while the active tab has no
 * quiz session.
 *
 * Rendering is derived from the quiz store (the persisted mirror lives in
 * TabState.quizSession via quiz-store.commit); the structural stage key is
 * the legacy render signature — answer flows through class changes on the
 * SAME option buttons, so the pop/shake CSS fires exactly once per answer
 * and never replays on restore (`static`).
 *
 * Animations: motion/react for stage transitions + the score ring (reduced
 * motion honored by the root MotionConfig), CSS keyframes for answer
 * feedback and the 3D card flip (backface-3d has no motion equivalent) with
 * a reduced-motion kill-switch, and the legacy confetti canvas for full marks.
 */
import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight, Check, Download, Flag, Layers, ListRestart, LoaderCircle,
  MessageSquarePlus, RotateCcw, Shuffle, Square, X,
} from 'lucide-react';
import { t } from '@/shared/i18n.js';
import type { QuizSession } from '@/shared/quiz';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { useQuizStore } from '@/panel/stores/quiz-store';
import {
  answerQuestion, backToSummary, dismissQuiz, drillUnknownCards, exportCsv, followupDraft,
  gotoNextQuestion, gradeCard, letter, requestVariant, retakeWrongQuestions,
  startDeck, startQuiz, stopQuiz, wrongAnswerIndexes,
} from '@/panel/lib/quiz-controller';
import { MarkdownView } from '@/panel/components/chat/MarkdownView';

/** The legacy stage signature — re-mount the stage only when structure moved. */
function stageKey(s: QuizSession): string {
  return [s.phase, s.current, s.quiz.questions.length, s.deck.index, s.deck.order.length, s.generating ? 1 : 0].join(':');
}

export function QuizCard(): ReactElement | null {
  const activeTabId = useTabsStore(s => s.activeTabId);
  // Adopt the tab's persisted session on mount / tab switch — the React
  // equivalent of the legacy QUIZ_REBUILD_REQUEST re-mount.
  useEffect(() => {
    if (activeTabId != null) useQuizStore.getState().adopt(activeTabId);
  }, [activeTabId]);

  const session = useQuizStore(s => (activeTabId != null ? s.sessions[activeTabId] : undefined));
  const variantBusy = useQuizStore(s => (activeTabId != null ? s.variantBusy[activeTabId] === true : false));
  const flipped = useQuizStore(s => (activeTabId != null ? s.flipped[activeTabId] === true : false));
  if (activeTabId == null || !session) return null;

  const total = session.quiz.questions.length;
  const answeredCount = session.answers.reduce<number>((n, a) => n + (a != null ? 1 : 0), 0);
  const ratio = session.phase === 'answering' && total ? answeredCount / total : total ? 1 : 0;

  return (
    <motion.section
      className="quiz-card"
      aria-label={t('quiz.title')}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="quiz-header">
        <div className="quiz-title">{t('quiz.title')}</div>
        <div className="quiz-progress">
          <div className="quiz-progress-fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
        {session.phase === 'answering' && total > 0 && (
          <div className="quiz-counter">
            {t('quiz.progress', { current: String(Math.min(session.current + 1, total)), total: String(total) })}
          </div>
        )}
        {session.generating && (
          <button type="button" className="quiz-stop icon-btn" title={t('action.stop')} onClick={stopQuiz}>
            <Square size={13} />
          </button>
        )}
        {/* The card's ONLY exit while a session exists — the session is
            persisted in TabState, so without this the quiz card squats on
            the panel forever (survives restarts via adopt). */}
        <button
          type="button"
          className="quiz-stop icon-btn"
          title={t('quiz.close')}
          aria-label={t('quiz.close')}
          onClick={() => dismissQuiz(activeTabId)}
        >
          <X size={13} />
        </button>
      </div>
      {session.error && <div className="quiz-error">{session.error}</div>}
      <motion.div
        key={stageKey(session)}
        className="quiz-stage"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
      >
        {session.phase === 'answering'
          ? <QuestionStage tabId={activeTabId} session={session} variantBusy={variantBusy} />
          : session.phase === 'deck'
            ? <DeckStage tabId={activeTabId} session={session} flipped={flipped} />
            : <SummaryStage tabId={activeTabId} session={session} variantBusy={variantBusy} />}
      </motion.div>
    </motion.section>
  );
}

// --- Answering phase -----------------------------------------------------------

function QuestionStage({ tabId, session, variantBusy }: { tabId: number; session: QuizSession; variantBusy: boolean }) {
  if (!session.quiz.questions.length) {
    return (
      <div className="quiz-status">
        <LoaderCarousel />
        <span>{t('quiz.generating')}</span>
      </div>
    );
  }
  const qi = Math.min(session.current, session.quiz.questions.length - 1);
  const q = session.quiz.questions[qi]!;
  const chosen = session.answers[qi];
  const answered = chosen != null;
  const isLast = qi + 1 >= session.quiz.questions.length;
  return (
    <div>
      <div className={`quiz-question${answered ? ' static' : ''}`}>
        <div className="quiz-q">{q.question}</div>
        <div className="quiz-options">
          {q.options.map((opt, oi) => (
            <button
              key={oi}
              type="button"
              className={[
                'quiz-option',
                answered && oi === q.answer ? 'correct' : '',
                answered && oi === chosen && oi !== q.answer ? 'wrong chosen' : '',
              ].filter(Boolean).join(' ')}
              disabled={answered}
              onClick={() => answerQuestion(tabId, qi, oi)}
            >
              {letter(oi)}. {opt}
            </button>
          ))}
        </div>
      </div>
      {answered && (
        <div className="quiz-feedback">
          <div className="quiz-explanation">
            <MarkdownView text={q.explanation + (q.paragraph != null ? ` [#${q.paragraph}]` : '')} />
          </div>
          <div className="quiz-actions">
            {chosen !== q.answer && (
              <>
                <button type="button" className="quiz-btn ghost" onClick={() => followupDraft(tabId, qi)}>
                  <MessageSquarePlus size={14} />{t('quiz.followup')}
                </button>
                <VariantButton tabId={tabId} qi={qi} busy={variantBusy} />
              </>
            )}
            {isLast && session.generating ? (
              <button type="button" className="quiz-btn primary" disabled>{t('quiz.generatingMore')}</button>
            ) : (
              <button type="button" className="quiz-btn primary" onClick={() => gotoNextQuestion(tabId)}>
                {isLast ? <Flag size={14} /> : <ArrowRight size={14} />}
                {isLast ? t('quiz.finish') : t('quiz.next')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function VariantButton({ tabId, qi, busy }: { tabId: number; qi: number; busy: boolean }) {
  return (
    <button
      type="button"
      className="quiz-btn ghost"
      disabled={busy}
      onClick={() => void requestVariant(tabId, qi)}
    >
      {busy ? <LoaderCarousel /> : <Shuffle size={14} />}
      {busy ? t('quiz.variantGenerating') : t('quiz.variant')}
    </button>
  );
}

// --- Summary phase -------------------------------------------------------------

function SummaryStage({ tabId, session, variantBusy }: { tabId: number; session: QuizSession; variantBusy: boolean }) {
  const qs = session.quiz.questions;
  const total = qs.length;
  const correct = qs.reduce((n, q, i) => n + (session.answers[i] === q.answer ? 1 : 0), 0);
  const wrong = wrongAnswerIndexes(session);
  const ratio = total ? correct / total : 0;

  // Full marks celebrate once per arrival at the result.
  useEffect(() => {
    if (total > 0 && correct === total) celebrate();
  }, [total, correct]);

  return (
    <div className="quiz-summary">
      {total > 0 && (
        <>
          <ScoreRing correct={correct} total={total} />
          <div className="quiz-grade">
            {ratio >= 0.8 ? t('quiz.grade.great') : ratio >= 0.6 ? t('quiz.grade.good') : t('quiz.grade.poor')}
          </div>
        </>
      )}
      {wrong.length > 0 && (
        <>
          <div className="quiz-subtitle">{t('quiz.wrongReview')}</div>
          <div className="quiz-wrong-list">
            {wrong.map(i => <WrongItem key={i} tabId={tabId} session={session} qi={i} variantBusy={variantBusy} />)}
          </div>
        </>
      )}
      <div className="quiz-actions quiz-main-actions">
        {wrong.length > 0 && (
          <button type="button" className="quiz-btn ghost" onClick={() => retakeWrongQuestions(tabId)}>
            <ListRestart size={14} />{t('quiz.retakeWrong')}
          </button>
        )}
        {session.quiz.flashcards.length > 0 && (
          <button type="button" className="quiz-btn ghost" onClick={() => startDeck(tabId)}>
            <Layers size={14} />{t('quiz.deck')}
          </button>
        )}
        <button type="button" className="quiz-btn ghost" onClick={() => void startQuiz()}>
          <RotateCcw size={14} />{t('quiz.again')}
        </button>
        <button type="button" className="quiz-btn ghost" onClick={() => exportCsv(tabId)}>
          <Download size={14} />{t('quiz.exportAnki')}
        </button>
      </div>
    </div>
  );
}

function WrongItem({ tabId, session, qi, variantBusy }: { tabId: number; session: QuizSession; qi: number; variantBusy: boolean }) {
  const q = session.quiz.questions[qi]!;
  const chosen = session.answers[qi]!;
  return (
    <div className="quiz-wrong-item">
      <div className="quiz-q">{q.question}</div>
      <div className="quiz-answer-line">
        {t('quiz.answerLine', {
          chosen: `${letter(chosen)}. ${q.options[chosen]}`,
          correct: `${letter(q.answer)}. ${q.options[q.answer]}`,
        })}
      </div>
      <div className="quiz-explanation">
        <MarkdownView text={q.explanation + (q.paragraph != null ? ` [#${q.paragraph}]` : '')} />
      </div>
      <div className="quiz-actions">
        <button type="button" className="quiz-btn ghost" onClick={() => followupDraft(tabId, qi)}>
          <MessageSquarePlus size={14} />{t('quiz.followup')}
        </button>
        <VariantButton tabId={tabId} qi={qi} busy={variantBusy} />
      </div>
    </div>
  );
}

function ScoreRing({ correct, total }: { correct: number; total: number }) {
  const R = 40;
  const C = 2 * Math.PI * R;
  return (
    <div className="quiz-ring">
      <svg viewBox="0 0 96 96" width="96" height="96" role="img"
        aria-label={t('quiz.score', { correct: String(correct), total: String(total) })}>
        <circle className="ring-track" cx="48" cy="48" r={R} fill="none" strokeWidth="8" />
        <motion.circle
          className="ring-fill"
          cx="48" cy="48" r={R} fill="none" strokeWidth="8"
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: C * (1 - correct / total) }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </svg>
      <div className="quiz-ring-text">{correct}/{total}</div>
    </div>
  );
}

// --- Deck phase ----------------------------------------------------------------

function DeckStage({ tabId, session, flipped }: { tabId: number; session: QuizSession; flipped: boolean }) {
  const deck = session.deck;

  if (deck.index >= deck.order.length) {
    // Run finished: stats + what next.
    const unknown = deck.order.filter(i => deck.known[i] !== true).length;
    return (
      <div className="quiz-summary">
        <div className="quiz-grade">
          {t('quiz.deckResult', { known: String(deck.order.length - unknown), unknown: String(unknown) })}
        </div>
        <div className="quiz-actions">
          {unknown > 0 && (
            <button type="button" className="quiz-btn ghost" onClick={() => drillUnknownCards(tabId)}>
              <ListRestart size={14} />{t('quiz.deckAgain')}
            </button>
          )}
          <button type="button" className="quiz-btn ghost" onClick={() => backToSummary(tabId)}>
            <ArrowRight size={14} />{t('quiz.backToSummary')}
          </button>
        </div>
      </div>
    );
  }

  const card = session.quiz.flashcards[deck.order[deck.index]!]!;
  const flip = (): void => useQuizStore.getState().setFlipped(tabId, !flipped);
  return (
    <div className="quiz-deck-stage">
      <div className="quiz-deck-count">
        {t('quiz.deckCount', { current: String(deck.index + 1), total: String(deck.order.length) })}
      </div>
      {/* Click / Enter / Space flips; grading unlocks only after the first flip. */}
      <div
        className={`flashcard-scene${flipped ? ' flipped' : ''}`}
        role="button"
        tabIndex={0}
        title={t('quiz.flip')}
        onClick={flip}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
        }}
      >
        <div className="flashcard3d">
          <div className="flashcard-face front">{card.front}</div>
          <div className="flashcard-face back">{card.back}</div>
        </div>
      </div>
      <div className="quiz-deck-hint">{t('quiz.flip')}</div>
      <div className="quiz-actions quiz-deck-actions">
        <button type="button" className="quiz-btn bad" disabled={!flipped} onClick={() => gradeCard(tabId, false)}>
          <X size={14} />{t('quiz.deckUnknown')}
        </button>
        <button type="button" className="quiz-btn good" disabled={!flipped} onClick={() => gradeCard(tabId, true)}>
          <Check size={14} />{t('quiz.deckKnown')}
        </button>
      </div>
    </div>
  );
}

// --- Shared bits ---------------------------------------------------------------

/** Inline spinning loader (the panel's CSS kill-switch covers reduced motion). */
function LoaderCarousel() {
  return <LoaderCircle size={14} className="quiz-spinner-icon" />;
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
