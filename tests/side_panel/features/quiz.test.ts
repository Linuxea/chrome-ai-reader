import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/shared/i18n.js', () => ({ t: (k: string, p?: Record<string, string>) => `[${k}]${p ? JSON.stringify(p) : ''}`, getCurrentLang: () => 'zh' }));
vi.mock('../../../src/shared/download.js', () => ({ downloadFile: vi.fn() }));
vi.mock('../../../src/side_panel/ui/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../../../src/side_panel/ui/dom-helpers.js', () => ({ smartScrollToBottom: vi.fn() }));
vi.mock('../../../src/side_panel/ui/citations.js', () => ({ linkifyCitations: vi.fn() }));

import { renderQuiz } from '../../../src/side_panel/features/quiz';
import { downloadFile } from '../../../src/shared/download.js';

const quiz = {
  questions: [
    { question: 'Q1', options: ['a', 'b'], answer: 1, explanation: 'why', paragraph: 2 },
    { question: 'Q2', options: ['c', 'd'], answer: 0, explanation: 'because' },
  ],
  flashcards: [{ front: 'front', back: 'back' }],
};

beforeEach(() => { document.body.innerHTML = '<div id="card"><div class="quiz-status"></div></div>'; });

describe('features/quiz renderQuiz', () => {
  it('marks answers, reveals explanations and keeps score', () => {
    const card = document.getElementById('card')!;
    renderQuiz(card, quiz);
    const q = card.querySelectorAll('.quiz-question');
    (q[0].querySelectorAll('.quiz-option')[0] as HTMLButtonElement).click(); // wrong
    (q[1].querySelectorAll('.quiz-option')[0] as HTMLButtonElement).click(); // right
    expect(q[0].querySelector('.wrong')?.textContent).toBe('A. a');
    expect(q[0].querySelector('.correct')?.textContent).toBe('B. b');
    expect(q[0].querySelector('.quiz-explanation')!.classList.contains('hidden')).toBe(false);
    expect(card.querySelector('.quiz-score')!.textContent).toBe('[quiz.score]{"correct":"1","total":"2"}');
    expect([...q[0].querySelectorAll('button')].every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it('flips flashcards and exports CSV', () => {
    const card = document.getElementById('card')!;
    renderQuiz(card, quiz);
    const fc = card.querySelector('.flashcard') as HTMLButtonElement;
    fc.click();
    expect(fc.textContent).toBe('back');
    (card.querySelector('.quiz-export') as HTMLButtonElement).click();
    expect(vi.mocked(downloadFile).mock.calls[0][0]).toContain('"front","back"');
  });
});
