import { describe, it, expect } from 'vitest';
import { genId, ensureMessageIds } from '../../src/shared/ids';
import type { ChatMessage } from '../../src/shared/types';

describe('shared/ids', () => {
  it('genId returns distinct v4 UUIDs', () => {
    const a = genId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(genId()).not.toBe(a);
  });

  it('ensureMessageIds fills only missing ids, in place', () => {
    const msgs: ChatMessage[] = [
      { id: 'keep', role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ];
    const out = ensureMessageIds(msgs);
    expect(out).toBe(msgs);
    expect(msgs[0].id).toBe('keep');
    expect(msgs[1].id).toEqual(expect.any(String));
  });
});
