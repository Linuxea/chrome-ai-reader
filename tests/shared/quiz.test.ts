import { describe, it, expect } from 'vitest';
import { parseQuiz, quizToCsv, createQuizStreamParser, parseVariantQuestion } from '../../src/shared/quiz';

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

describe('shared/quiz createQuizStreamParser', () => {
  const full = JSON.stringify({
    questions: [
      { question: 'Q1?', options: ['a', 'b'], answer: 0, explanation: 'e1', paragraph: 1 },
      { question: 'Q2?', options: ['c', 'd'], answer: 1, explanation: 'e2' },
      { question: 'Q3 "quoted { brace}", ok?', options: ['e', 'f'], answer: 0, explanation: 'e3' },
    ],
    flashcards: [{ front: 'F1', back: 'B1' }],
  });

  /** Feed `text` through the parser in random 1–7 char chunks. */
  const feed = (parser: ReturnType<typeof createQuizStreamParser>, text: string) => {
    const emitted: string[] = [];
    for (let i = 0; i < text.length;) {
      const step = 1 + Math.floor(Math.random() * 7);
      for (const q of parser.push(text.slice(i, i + step))) emitted.push(q.question);
      i += step;
    }
    return emitted;
  };

  it('emits questions incrementally regardless of chunk boundaries', () => {
    for (let run = 0; run < 8; run++) {
      const parser = createQuizStreamParser();
      const emitted = feed(parser, full);
      expect(emitted).toEqual(['Q1?', 'Q2?', 'Q3 "quoted { brace}", ok?']);
      expect(parser.flush()).toEqual(parseQuiz(full));
    }
  });

  it('tolerates preamble junk and a markdown fence before the JSON', () => {
    const parser = createQuizStreamParser();
    const withJunk = `Sure! Here is your quiz:\n\`\`\`json\n${full}\n\`\`\``;
    expect(feed(parser, withJunk)).toEqual(['Q1?', 'Q2?', 'Q3 "quoted { brace}", ok?']);
    expect(parser.flush()?.flashcards).toEqual([{ front: 'F1', back: 'B1' }]);
  });

  it('drops malformed elements while streaming', () => {
    const parser = createQuizStreamParser();
    const emitted = feed(parser, JSON.stringify({
      questions: [
        { question: 'ok?', options: ['a', 'b'], answer: 0 },
        { question: 'bad answer index', options: ['a', 'b'], answer: 9 },
        { question: 'also ok?', options: ['c', 'd'], answer: 1 },
      ],
    }));
    expect(emitted).toEqual(['ok?', 'also ok?']);
  });

  it('emits nothing while waiting for the questions array', () => {
    const parser = createQuizStreamParser();
    expect(parser.push('{"ques')).toEqual([]);
    expect(parser.push('tions": [')).toEqual([]);
    const [q1] = parser.push('{"question":"Q?","options":["a","b"],"answer":0}');
    expect(q1?.question).toBe('Q?');
  });
});

describe('shared/quiz parseVariantQuestion', () => {
  const question = { question: 'V?', options: ['x', 'y'], answer: 1, explanation: 'exp' };

  it('parses the wrapped {"question":{…}} shape', () => {
    expect(parseVariantQuestion(JSON.stringify({ question }))).toEqual(question);
  });

  it('parses a bare question object', () => {
    expect(parseVariantQuestion(JSON.stringify(question))).toEqual(question);
  });

  it('returns null on garbage or malformed questions', () => {
    expect(parseVariantQuestion('no json')).toBeNull();
    expect(parseVariantQuestion('{"question":{"question":"v","options":["a"],"answer":0}}')).toBeNull();
  });
});
