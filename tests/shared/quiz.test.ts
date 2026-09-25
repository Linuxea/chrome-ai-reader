import { describe, it, expect } from 'vitest';
import { parseQuiz, quizToCsv } from '../../src/shared/quiz';

describe('shared/quiz', () => {
  it('parses fenced JSON and drops malformed questions / cards', () => {
    const raw = '```json\n' + JSON.stringify({
      questions: [
        { question: 'Q1?', options: ['a', 'b', 'c'], answer: 1, explanation: 'because', paragraph: 3 },
        { question: 'bad answer', options: ['a', 'b'], answer: 5 },
        { question: 'one option', options: ['a'], answer: 0 },
      ],
      flashcards: [{ front: 'F', back: 'B' }, { front: '', back: 'x' }],
    }) + '\n```';
    expect(parseQuiz(raw)).toEqual({
      questions: [{ question: 'Q1?', options: ['a', 'b', 'c'], answer: 1, explanation: 'because', paragraph: 3 }],
      flashcards: [{ front: 'F', back: 'B' }],
    });
  });

  it('returns null when nothing is usable', () => {
    expect(parseQuiz('no json here')).toBeNull();
    expect(parseQuiz('{"questions": []}')).toBeNull();
  });

  it('exports Anki CSV with escaped quotes', () => {
    const csv = quizToCsv({
      questions: [{ question: 'Which "one"?', options: ['x', 'y'], answer: 1, explanation: 'e' }],
      flashcards: [{ front: 'a,b', back: 'c' }],
    });
    expect(csv).toBe('"a,b","c"\n"Which ""one""?\n\nA. x\nB. y","B. y\n\ne"\n');
  });
});
