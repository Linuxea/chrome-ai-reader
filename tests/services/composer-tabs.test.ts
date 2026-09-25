import { vi, describe, it, expect } from 'vitest';

vi.mock('../../src/side_panel/services/images.js', () => ({
  collectImageDataUris: () => [], clearImagePreviews: vi.fn(), hasPendingImages: () => false,
}));

import {
  toggleAttachedTab, detachTab, getAttachedTabs, onAttachedTabsChange, consumeAttachments, MAX_ATTACHED_TABS,
} from '../../src/side_panel/services/composer';

const tab = (id: number) => ({ id, title: `T${id}`, url: `https://t${id}.example` });

describe('composer attached tabs (F4)', () => {
  it('toggles, caps at MAX_ATTACHED_TABS, notifies, and is consumed with the message', () => {
    const seen: number[][] = [];
    const off = onAttachedTabsChange((tabs) => seen.push(tabs.map((t) => t.id)));
    for (let i = 1; i <= MAX_ATTACHED_TABS; i++) expect(toggleAttachedTab(tab(i))).toBe(true);
    expect(toggleAttachedTab(tab(99))).toBe(false);
    expect(toggleAttachedTab(tab(1))).toBe(true); // detaches
    detachTab(2);
    expect(getAttachedTabs().map((t) => t.id)).toEqual([3, 4].slice(0, MAX_ATTACHED_TABS - 2));
    const { tabs } = consumeAttachments();
    expect(tabs.map((t) => t.id)).toEqual([3, 4].slice(0, MAX_ATTACHED_TABS - 2));
    expect(getAttachedTabs()).toEqual([]);
    expect(seen.at(-1)).toEqual([]);
    off();
  });
});
