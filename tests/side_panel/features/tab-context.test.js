/**
 * Tests for side_panel/features/tab-context.ts — the "attach other tabs"
 * picker (F4).
 *
 * Behavior through the real DOM: button toggle, row toggle + chips,
 * click-away close, attach limit, send-time consume. Plus a static CSS
 * assertion: `.tab-picker.hidden` / `.tab-chip-bar.hidden` must exist — there
 * is no global `.hidden` rule, so a missing component rule leaves the popup
 * permanently visible (it never visually closed).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../../src/shared/i18n.js', () => ({
  t: (k) => `[${k}]`,
}));
vi.mock('../../../src/side_panel/state.js', () => ({
  getActiveTabId: vi.fn(() => 1),
}));
vi.mock('../../../src/side_panel/services/images.js', () => ({
  collectImageDataUris: vi.fn(() => []),
  clearImagePreviews: vi.fn(),
  hasPendingImages: vi.fn(() => false),
}));

const { createChromeMock } = await import('../../helpers/chrome-mock.js');

import { initTabContext, candidateTabs } from '../../../src/side_panel/features/tab-context.js';
import * as composer from '../../../src/side_panel/services/composer.js';

function makeTabs() {
  return [
    { id: 1, title: 'Active tab', url: 'https://active.example.com' },
    { id: 2, title: 'Second tab', url: 'https://second.example.com' },
    { id: 3, title: 'Third tab', url: 'https://third.example.com' },
    { id: 4, title: '', url: 'https://notitle.example.com' },
    { id: 5, title: 'Internal', url: 'chrome://extensions' },
  ];
}

describe('tab-context (F4 attach other tabs)', () => {
  let button, picker, chipBar;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="imagePreviewBar" class="hidden"></div>
      <button id="tabContextBtn"></button>
      <div id="tabPicker" class="tab-picker hidden"></div>
      <div id="tabChipBar" class="hidden"></div>`;
    button = document.getElementById('tabContextBtn');
    picker = document.getElementById('tabPicker');
    chipBar = document.getElementById('tabChipBar');

    const { chrome } = createChromeMock();
    chrome.tabs.query = vi.fn(async () => makeTabs());
    globalThis.chrome = chrome;

    // composer tab selection is module state — reset between tests
    composer.getAttachedTabs().forEach((t) => composer.detachTab(t.id));

    initTabContext({ button, picker, chipBar });
  });

  it('button click opens the picker and lists candidate tabs', async () => {
    button.click();
    await vi.waitFor(() => expect(picker.classList.contains('hidden')).toBe(false));
    const rows = picker.querySelectorAll('.tab-picker-item');
    expect(rows.length).toBe(3); // excludes the active tab + chrome:// pages
  });

  it('second button click closes the picker', async () => {
    button.click();
    await vi.waitFor(() => expect(picker.classList.contains('hidden')).toBe(false));
    button.click();
    expect(picker.classList.contains('hidden')).toBe(true);
  });

  it('clicking a row attaches the tab (chip + selected); clicking again detaches', async () => {
    button.click();
    await vi.waitFor(() => expect(picker.querySelectorAll('.tab-picker-item').length).toBe(3));
    const row = picker.querySelectorAll('.tab-picker-item')[0];
    row.click();
    expect(composer.getAttachedTabs().map((t) => t.id)).toEqual([2]);
    expect(row.classList.contains('selected')).toBe(true);
    expect(chipBar.classList.contains('hidden')).toBe(false);
    expect(chipBar.querySelectorAll('.tab-chip').length).toBe(1);

    row.click();
    expect(composer.getAttachedTabs()).toEqual([]);
    expect(chipBar.classList.contains('hidden')).toBe(true);
  });

  it('chip ✕ detaches the tab', async () => {
    button.click();
    await vi.waitFor(() => expect(picker.querySelectorAll('.tab-picker-item').length).toBe(3));
    picker.querySelectorAll('.tab-picker-item')[0].click();

    chipBar.querySelector('.tab-chip-remove').click();
    expect(composer.getAttachedTabs()).toEqual([]);
    expect(chipBar.classList.contains('hidden')).toBe(true);
  });

  it('clicking outside closes the picker but keeps the chips', async () => {
    button.click();
    await vi.waitFor(() => expect(picker.querySelectorAll('.tab-picker-item').length).toBe(3));
    picker.querySelectorAll('.tab-picker-item')[0].click();
    document.body.click();
    expect(picker.classList.contains('hidden')).toBe(true);
    expect(composer.getAttachedTabs().length).toBe(1);
  });

  it('enforces the max-attach limit', async () => {
    globalThis.chrome.tabs.query = vi.fn(async () => [
      { id: 1, title: 'Active', url: 'https://a.example.com' },
      ...[2, 3, 4, 5, 6].map((i) => ({ id: i, title: `T${i}`, url: `https://t${i}.example.com` })),
    ]);
    button.click();
    await vi.waitFor(() => expect(picker.querySelectorAll('.tab-picker-item').length).toBe(5));
    const rows = picker.querySelectorAll('.tab-picker-item');
    rows[0].click(); rows[1].click(); rows[2].click(); rows[3].click();
    expect(composer.getAttachedTabs().length).toBe(4);

    rows[4].click(); // over the limit — refused
    expect(composer.getAttachedTabs().length).toBe(4);
    expect(rows[4].classList.contains('selected')).toBe(false);
  });

  it('consumeAttachments (send) takes the tabs and clears the chips', async () => {
    button.click();
    await vi.waitFor(() => expect(picker.querySelectorAll('.tab-picker-item').length).toBe(3));
    picker.querySelectorAll('.tab-picker-item')[0].click();

    const { tabs } = composer.consumeAttachments();
    expect(tabs.map((t) => t.id)).toEqual([2]);
    expect(chipBar.classList.contains('hidden')).toBe(true);
    expect(composer.getAttachedTabs()).toEqual([]);
  });

  it('candidateTabs excludes the active tab and non-http(s) tabs, falls back to url as title', async () => {
    const tabs = await candidateTabs();
    expect(tabs.map((t) => t.id)).toEqual([2, 3, 4]);
    expect(tabs[2].title).toBe('https://notitle.example.com');
  });
});

describe('tab-context CSS regression (no global .hidden utility)', () => {
  const css = readFileSync(resolve(__dirname, '../../../src/side_panel/side_panel.css'), 'utf8');

  it('.tab-picker.hidden hides the picker — without this rule the popup never visually closes', () => {
    expect(css).toMatch(/\.tab-picker\.hidden\s*\{\s*display:\s*none/);
  });

  it('.tab-chip-bar.hidden hides the empty chip bar', () => {
    expect(css).toMatch(/\.tab-chip-bar\.hidden\s*\{\s*display:\s*none/);
  });
});
