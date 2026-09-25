/**
 * Server-Sent Events parser (WHATWG event-stream format), pure and
 * incremental: feed it decoded text chunks in any split, get whole events.
 *
 * Handles what the old line-splitter did not: `data:` with or without the
 * space, CRLF / CR line endings, multi-line `data` (joined with \n),
 * `event:` names, and `:` comment / keep-alive lines.
 */

export interface SSEEvent {
  /** `event:` field; '' when absent (the "message" type). */
  event: string;
  data: string;
}

export interface SSEParser {
  /** Feed a decoded chunk; returns the events it completed. */
  push(chunk: string): SSEEvent[];
  /** End of stream: dispatch a final event not terminated by a blank line. */
  flush(): SSEEvent[];
}

export function createSSEParser(): SSEParser {
  let buffer = '';
  let event = '';
  let data: string[] = [];
  let hasData = false;

  const dispatch = (out: SSEEvent[]): void => {
    if (hasData) out.push({ event, data: data.join('\n') });
    event = '';
    data = [];
    hasData = false;
  };

  const processLine = (line: string, out: SSEEvent[]): void => {
    if (line === '') { dispatch(out); return; }
    if (line.startsWith(':')) return; // comment / keep-alive
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') { data.push(value); hasData = true; }
    else if (field === 'event') event = value;
    // `id` / `retry` are irrelevant for one-shot fetch streams.
  };

  return {
    push(chunk: string): SSEEvent[] {
      const out: SSEEvent[] = [];
      buffer += chunk;
      // Split on CRLF, LF or CR; keep a trailing partial line (a lone \r may
      // be the first half of a CRLF split across chunks, so hold it back).
      let start = 0;
      for (let i = 0; i < buffer.length; i++) {
        const c = buffer[i];
        if (c !== '\n' && c !== '\r') continue;
        if (c === '\r' && i === buffer.length - 1) break;
        processLine(buffer.slice(start, i), out);
        if (c === '\r' && buffer[i + 1] === '\n') i++;
        start = i + 1;
      }
      buffer = buffer.slice(start);
      return out;
    },
    flush(): SSEEvent[] {
      const out: SSEEvent[] = [];
      if (buffer) { processLine(buffer.replace(/\r$/, ''), out); buffer = ''; }
      dispatch(out);
      return out;
    },
  };
}
