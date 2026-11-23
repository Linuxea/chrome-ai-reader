import { describe, it, expect, beforeEach } from 'vitest';
import { useStreamStore } from '@/panel/stores/stream-store';
import type { WebCallEvent } from '@/shared/protocol';

const STARTED: WebCallEvent = { type: 'call_started', step: 0, call: { id: 'c1', index: 0, kind: 'deep_search', action: { type: 'search', queries: ['q1', 'q2'] } } };

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

  // F15 web search trace
  it('web steps: a start appends a running step; completions fill their step by id, whatever order they arrive in', () => {
    const s = useStreamStore.getState();
    s.start(1);
    s.addSearchEvent(1, STARTED);
    s.addSearchEvent(1, { type: 'call_started', step: 1, call: { id: 'c2', index: 0, kind: 'deep_search', action: { type: 'open_page', url: 'https://a.test/' } } });
    s.addSearchEvent(1, { type: 'call_started', step: 1, call: { id: 'c3', index: 1, kind: 'deep_search', action: { type: 'open_page', url: 'https://b.test/' } } });
    // Within step 1 the second call completes first (observed on the live API).
    s.addSearchEvent(1, { type: 'call_completed', step: 1, call: { id: 'c3', index: 1, status: 'completed', page: { url: 'https://b.test/', title: 'B' } } });
    s.addSearchEvent(1, { type: 'call_completed', step: 0, call: { id: 'c1', index: 0, status: 'completed', sources: [{ url: 'https://a.test/', title: 'A', siteName: 'A site' }] } });
    expect(useStreamStore.getState().streams[1]!.webSteps).toEqual([
      { id: 'c1', kind: 'deep_search', action: { type: 'search', queries: ['q1', 'q2'] }, status: 'completed', sources: [{ url: 'https://a.test/', title: 'A', siteName: 'A site' }] },
      { id: 'c2', kind: 'deep_search', action: { type: 'open_page', url: 'https://a.test/' }, status: 'running' },
      { id: 'c3', kind: 'deep_search', action: { type: 'open_page', url: 'https://b.test/' }, status: 'completed', page: { url: 'https://b.test/', title: 'B' } },
    ]);
  });

  it('web steps: a duplicate start and an orphan completion are ignored; a failed call records its error', () => {
    const s = useStreamStore.getState();
    s.start(1);
    // No start was ever seen for this id — nothing to attach the result to.
    s.addSearchEvent(1, { type: 'call_completed', step: 0, call: { id: 'orphan', index: 0, status: 'completed', sources: [{ url: 'https://x.test/', title: 'X' }] } });
    s.addSearchEvent(1, STARTED);
    s.addSearchEvent(1, { ...STARTED, call: { ...STARTED.call, action: { type: 'search', queries: ['again'] } } });
    s.addSearchEvent(1, { type: 'call_completed', step: 0, call: { id: 'c1', index: 0, status: 'failed', error: 'unavailable' } });
    expect(useStreamStore.getState().streams[1]!.webSteps).toEqual([
      { id: 'c1', kind: 'deep_search', action: { type: 'search', queries: ['q1', 'q2'] }, status: 'failed', error: 'unavailable' },
    ]);
  });

  it('web steps: ignored once the stream has left "streaming"; a restart clears them', () => {
    const s = useStreamStore.getState();
    s.start(1);
    s.addSearchEvent(1, STARTED);
    s.abort(1, 'stopped');
    s.addSearchEvent(1, { type: 'call_completed', step: 0, call: { id: 'c1', index: 0, status: 'completed' } });
    expect(useStreamStore.getState().streams[1]!.webSteps.map(step => step.status)).toEqual(['running']);
    s.start(1);
    expect(useStreamStore.getState().streams[1]!.webSteps).toEqual([]);
  });

  it('restart: forgets what a dead attempt streamed, keeps the entry and its assistant id', () => {
    const s = useStreamStore.getState();
    s.start(1);
    const assistantId = useStreamStore.getState().streams[1]!.assistantId;
    s.addSearchEvent(1, STARTED);
    s.appendThinking(1, 'half a thought');
    s.appendAnswer(1, 'text that must not exist at this point');
    s.startRound(1, 1);
    s.restart(1);
    expect(useStreamStore.getState().streams[1]).toEqual({
      tabId: 1, assistantId, thinking: '', answer: '', rounds: [], webSteps: [], status: 'streaming',
    });
    // Still streaming: new events of the retried attempt are accepted.
    s.addSearchEvent(1, STARTED);
    expect(useStreamStore.getState().streams[1]!.webSteps).toHaveLength(1);
    // Not streaming → nothing to restart.
    s.finish(1, { finishReason: 'stop' });
    s.restart(1);
    expect(useStreamStore.getState().streams[1]!.webSteps).toHaveLength(1);
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
