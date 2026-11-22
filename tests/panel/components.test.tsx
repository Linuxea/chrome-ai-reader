import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { store, connectMock } = vi.hoisted(() => {
  const store = { sync: {}, session: {}, local: {} };
  function createStorageArea(storeKey: string) {
    return {
      get(keys: unknown, cb?: (r: unknown) => void) {
        const result: Record<string, unknown> = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => { if (store[storeKey][k as string] !== undefined) result[k as string] = store[storeKey][k as string]; });
        if (cb) { cb(result); return; }
        return Promise.resolve(result);
      },
      set(items: Record<string, unknown>, cb?: () => void) {
        Object.entries(items).forEach(([k, v]) => { store[storeKey][k] = v; });
        if (cb) { cb(); return; }
        return Promise.resolve();
      },
      remove(keys: unknown, cb?: () => void) {
        (Array.isArray(keys) ? keys : [keys]).forEach(k => delete store[storeKey][k as string]);
        if (cb) { cb(); return; }
        return Promise.resolve();
      },
    };
  }
  const chrome = {
    storage: {
      sync: createStorageArea('sync'),
      session: createStorageArea('session'),
      local: createStorageArea('local'),
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(() => Promise.resolve([{ id: 42 }])),
      sendMessage: vi.fn(() => Promise.resolve({ success: true })),
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: {
      connect: vi.fn(() => ({
        name: 'ai-chat',
        postMessage: vi.fn(),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
        disconnect: vi.fn(),
      })),
      sendMessage: vi.fn(() => Promise.resolve({ success: true })),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      openOptionsPage: vi.fn(),
    },
    windows: { getCurrent: vi.fn(() => Promise.resolve({ id: 1 })) },
  };
  (globalThis as Record<string, unknown>).chrome = chrome;
  return { store, connectMock: chrome.runtime.connect as ReturnType<typeof vi.fn> };
});

import { useTabsStore } from '@/panel/stores/tabs-store';
import { useStreamStore } from '@/panel/stores/stream-store';
import { useComposerStore } from '@/panel/stores/composer-store';
import * as core from '@/panel/state';
import { MessageList } from '@/panel/components/chat/MessageList';
import { Composer } from '@/panel/components/composer/Composer';

describe('MessageList rendering', () => {
  beforeEach(async () => {
    store.session = {}; store.sync = {}; store.local = {};
    useStreamStore.setState({ streams: {} });
    useComposerStore.setState({ draftText: '', images: [], tabs: [] });
    await useTabsStore.getState().init();
    useTabsStore.getState().setConversationHistory([]);
    useTabsStore.getState().setPageContent('cached');
  });

  it('renders user bubble from meta and assistant markdown from history', () => {
    useTabsStore.getState().setConversationHistory([
      { id: 'u1', role: 'user', content: 'api content here', meta: { rawText: 'api content here', displayText: '显示文本' } },
      { id: 'a1', role: 'assistant', content: '# 标题\n\n**加粗**回答' },
    ]);
    const { container } = render(<MessageList />);
    expect(container.querySelector('[data-msg-id="u1"]')!.textContent).toContain('显示文本');
    const md = container.querySelector('[data-msg-id="a1"] .md-body')!;
    expect(md.querySelector('h1')!.textContent).toBe('标题');
    expect(md.querySelector('strong')!.textContent).toBe('加粗');
  });

  it('renders the live streaming entry with typing indicator when empty', () => {
    useTabsStore.getState().appendMessage({ id: 'u1', role: 'user', content: 'q' });
    useStreamStore.getState().start(42);
    const { container } = render(<MessageList />);
    expect(container.querySelector('.typing-indicator')).toBeTruthy();
    expect(container.querySelector('.stream-cursor')).toBeNull();
  });

  it('renders streaming answer text with cursor once chunks arrive', () => {
    useStreamStore.getState().start(42);
    useStreamStore.getState().appendAnswer(42, '部分回答');
    const { container } = render(<MessageList />);
    expect(container.querySelector('.md-body')!.textContent).toContain('部分回答');
    expect(container.querySelector('.stream-cursor')).toBeTruthy();
  });

  it('renders the error card with retry when a send failed', () => {
    useStreamStore.getState().start(42);
    useStreamStore.getState().fail(42, '网络错误', { id: 'u1', role: 'user', content: 'q', meta: { rawText: 'q', displayText: 'q' } });
    const { container } = render(<MessageList />);
    expect(container.querySelector('.error-card')!.textContent).toContain('网络错误');
    expect(container.querySelector('.failed-user')!.textContent).toContain('q');
  });
});

describe('Composer behavior', () => {
  beforeEach(async () => {
    store.session = {}; store.sync = {}; store.local = {};
    useStreamStore.setState({ streams: {} });
    useComposerStore.setState({ draftText: '', images: [], tabs: [] });
    connectMock.mockClear();
    await useTabsStore.getState().init();
    useTabsStore.getState().setConversationHistory([]);
    useTabsStore.getState().setPageContent('cached');
  });

  it('IME-composition Enter does NOT send; plain Enter does', async () => {
    render(<Composer />);
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '你好' } });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(useComposerStore.getState().draftText).toBe('你好');
    expect(core.getConversationHistory()).toHaveLength(0);

    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => {
      expect(useComposerStore.getState().draftText).toBe('');
      expect(core.getConversationHistory().length).toBe(1);
    });
  });

  it('Shift+Enter does not send', () => {
    render(<Composer />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'line' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(useComposerStore.getState().draftText).toBe('line');
    expect(core.getConversationHistory()).toHaveLength(0);
  });

  it('send button is ghosted (disabled) while empty, enabled by text OR images', async () => {
    render(<Composer />);
    const send = () => screen.getByRole('button', { name: '发送' });
    expect(send()).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '问题' } });
    expect(send()).toBeEnabled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    expect(send()).toBeDisabled();

    // Images alone are a valid message (submit()'s free-text guard).
    useComposerStore.setState({ images: [{ id: 'i1', dataUri: 'data:image/png;base64,x' }], tabs: [] });
    await vi.waitFor(() => expect(send()).toBeEnabled());
  });

  it('composer tools: folded-out tools land in the "+" menu (live from settings)', async () => {
    // Only "upload" stays in the bar — the other three fold into the menu.
    store.sync.composerTools = ['upload'];
    render(<Composer />);

    // Wait for readSettings to apply; the bar then has exactly one tool + "+”.
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: '更多工具' })).toBeInTheDocument();
    });
    const bar = document.querySelector('.input-wrapper')!;
    // DIRECT tool children of the bar: just "upload" (the "+" lives inside
    // its own .tools-menu-slot, not a direct child).
    const barTools = bar.querySelectorAll(':scope > .upload-btn');
    expect(barTools.length).toBe(1);
    expect(bar.querySelector('.tools-menu-slot')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '更多工具' }));
    const menu = document.querySelector('.tools-menu')!;
    const items = menu.querySelectorAll('.upload-btn');
    expect(items.length).toBe(3); // capture / captureFull / tabs — upload stays in the bar
    expect(menu.textContent).toContain('截取当前画面');
    expect(menu.textContent).toContain('整页截屏');
    expect(menu.textContent).toContain('附加其他标签页');
    expect(menu.textContent).not.toContain('上传图片');
  });

  it('composer tools: clicking "+" again CLOSES the menu (mousedown-outside vs click-toggle race)', async () => {
    store.sync.composerTools = ['upload'];
    render(<Composer />);
    const plus = await screen.findByRole('button', { name: '更多工具' });

    fireEvent.click(plus);
    expect(document.querySelector('.tools-menu')).not.toBeNull();

    // Real event order on a second click: mousedown (outside-menu listener
    // fires) THEN click (toggle). With the listener matching only .tools-menu,
    // the launcher itself was "outside": mousedown closed, click reopened —
    // the menu could never be dismissed by its own button.
    fireEvent.mouseDown(plus);
    fireEvent.click(plus);
    expect(document.querySelector('.tools-menu')).toBeNull();

    // And a genuinely-outside click closes it too.
    fireEvent.click(plus);
    expect(document.querySelector('.tools-menu')).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(document.querySelector('.tools-menu')).toBeNull();
  });

  it('typing "/" opens the command popup; Escape closes it', async () => {
    const { useUIStore } = await import('@/panel/stores/ui-store');
    render(<Composer />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '/' } });
    expect(useUIStore.getState().commandPopup.open).toBe(true);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(useUIStore.getState().commandPopup.open).toBe(false);
  });
});
