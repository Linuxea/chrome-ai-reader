import { describe, it, expect, vi } from 'vitest';
import { safePortDisconnect, safeEndOfStream } from '../../src/shared/chrome-helpers.ts';

describe('safePortDisconnect', () => {
  it('calls disconnect on valid port', () => {
    const port = { disconnect: vi.fn() };
    safePortDisconnect(port);
    expect(port.disconnect).toHaveBeenCalled();
  });

  it('does not throw when disconnect throws', () => {
    const port = { disconnect: vi.fn(() => { throw new Error('Already disconnected'); }) };
    expect(() => safePortDisconnect(port)).not.toThrow();
  });

  it('does not throw for null port', () => {
    expect(() => safePortDisconnect(null)).not.toThrow();
  });
});

describe('safeEndOfStream', () => {
  it('calls endOfStream when readyState is open', () => {
    const ms = { readyState: 'open', endOfStream: vi.fn() };
    safeEndOfStream(ms);
    expect(ms.endOfStream).toHaveBeenCalled();
  });

  it('does not call endOfStream when readyState is not open', () => {
    const ms = { readyState: 'closed', endOfStream: vi.fn() };
    safeEndOfStream(ms);
    expect(ms.endOfStream).not.toHaveBeenCalled();
  });

  it('does not throw when endOfStream throws', () => {
    const ms = { readyState: 'open', endOfStream: vi.fn(() => { throw new Error('network error'); }) };
    expect(() => safeEndOfStream(ms)).not.toThrow();
  });

  it('does not throw for null', () => {
    expect(() => safeEndOfStream(null)).not.toThrow();
  });
});
