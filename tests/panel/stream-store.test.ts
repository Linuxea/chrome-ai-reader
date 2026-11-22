import { describe, it, expect, beforeEach } from 'vitest';
import { useStreamStore } from '@/panel/stores/stream-store';

describe('stream-store', () => {
  beforeEach(() => {
    useStreamStore.setState({ streams: {} });
  });

  it('start creates a fresh streaming entry and resets prior content', () => {
    const s = useStreamStore.getState();
    s.start(1);
    s.appendAnswer(1, 'partial');
    s.start(1); // restart (e.g. resend) must not keep old text
    expect(useStreamStore.getState().streams[1]).toMatchObject({ tabId: 1, answer: '', status: 'streaming' });
  });

  it('accumulates thinking and answer independently, per tab', () => {
    const s = useStreamStore.getState();
    s.start(1);
    s.start(2);
    s.appendThinking(1, 'hmm ');
    s.appendThinking(1, 'hmm more');
    s.appendAnswer(1, 'Hello');
    s.appendAnswer(2, 'Other tab');
    const streams = useStreamStore.getState().streams;
    expect(streams[1]!.thinking).toBe('hmm hmm more');
    expect(streams[1]!.answer).toBe('Hello');
    expect(streams[2]!.answer).toBe('Other tab');
  });

  it('agent rounds: startRound is idempotent per round; calls append to the last round', () => {
    const s = useStreamStore.getState();
    s.start(1);
    s.startRound(1, 1);
    s.startRound(1, 1); // duplicate wire message — ignored
    s.addToolCall(1, { id: 'c1', type: 'function', function: { name: 'search', arguments: '{}' } } as never);
    s.startRound(1, 2);
    s.addToolCall(1, { id: 'c2', type: 'function', function: { name: 'read', arguments: '{}' } } as never);
    const rounds = useStreamStore.getState().streams[1]!.rounds;
    expect(rounds.map(r => r.round)).toEqual([1, 2]);
    expect(rounds[0]!.calls.map(c => c.function.name)).toEqual(['search']);
    expect(rounds[1]!.calls.map(c => c.function.name)).toEqual(['read']);
  });

  it('finish keeps accumulated text, records usage/model/finishReason, freezes appends', () => {
    const s = useStreamStore.getState();
    s.start(1);
    s.appendAnswer(1, 'the answer');
    s.finish(1, { finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5 }, model: 'gpt-x' });
    s.appendAnswer(1, 'late chunk'); // ignored after done
    const live = useStreamStore.getState().streams[1]!;
    expect(live).toMatchObject({ status: 'done', answer: 'the answer', model: 'gpt-x', finishReason: 'stop' });
    expect(live.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('fail marks error status with the message', () => {
    const s = useStreamStore.getState();
    s.start(1);
    s.fail(1, 'boom');
    expect(useStreamStore.getState().streams[1]).toMatchObject({ status: 'error', error: 'boom' });
  });

  it('clear removes the entry; clearing an absent tab is a no-op', () => {
    const s = useStreamStore.getState();
    s.start(1);
    s.clear(1);
    s.clear(1);
    expect(useStreamStore.getState().streams[1]).toBeUndefined();
  });
});
