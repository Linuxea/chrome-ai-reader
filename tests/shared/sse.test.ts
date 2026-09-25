import { describe, it, expect } from 'vitest';
import { createSSEParser } from '../../src/shared/sse';

describe('shared/sse createSSEParser', () => {
  it('parses events split across arbitrary chunk boundaries', () => {
    const p = createSSEParser();
    const text = 'data: {"a":1}\n\ndata: {"b":2}\n\n';
    const events = [];
    for (let i = 0; i < text.length; i += 3) events.push(...p.push(text.slice(i, i + 3)));
    expect(events).toEqual([{ event: '', data: '{"a":1}' }, { event: '', data: '{"b":2}' }]);
  });

  it('accepts data: without a space, CRLF and CR line endings', () => {
    const p = createSSEParser();
    expect(p.push('data:x\r\n\r\ndata: y\r\rdata: z\n\n')).toEqual([
      { event: '', data: 'x' }, { event: '', data: 'y' }, { event: '', data: 'z' },
    ]);
  });

  it('keeps a CR at a chunk end until it knows whether an LF follows', () => {
    const p = createSSEParser();
    expect(p.push('data: a\r')).toEqual([]);
    expect(p.push('\n\r\n')).toEqual([{ event: '', data: 'a' }]);
  });

  it('joins multi-line data, reads event names, ignores comments', () => {
    const p = createSSEParser();
    expect(p.push(': keep-alive\nevent: message_delta\ndata: line1\ndata: line2\n\n')).toEqual([
      { event: 'message_delta', data: 'line1\nline2' },
    ]);
  });

  it('flush dispatches a final unterminated event', () => {
    const p = createSSEParser();
    expect(p.push('data: tail')).toEqual([]);
    expect(p.flush()).toEqual([{ event: '', data: 'tail' }]);
  });
});
