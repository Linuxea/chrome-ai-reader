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
import type { WebResult } from '@/shared/types';
import { MessageList } from '@/panel/components/chat/MessageList';
import { Composer } from '@/panel/components/composer/Composer';

/** A finished search as `done.web` delivers it (one search, one page opened, two cited sources). */
const WEB: WebResult = {
  steps: [
    { id: 'c1', kind: 'deep_search', action: { type: 'search', queries: ['q1', 'q2'] }, status: 'completed', sources: [{ url: 'https://a.test/1', title: 'A one', siteName: 'A site' }] },
    { id: 'c2', kind: 'deep_search', action: { type: 'open_page', url: 'https://a.test/1' }, status: 'completed', page: { url: 'https://a.test/1', title: 'A one' } },
  ],
  sources: [{ url: 'https://a.test/1', title: 'A one', siteName: 'A site' }, { url: 'https://b.test/2', title: 'B two' }],
  citations: [{ start: 0, end: 5, source: 0 }, { start: 5, end: 10, source: 1 }],
  searches: 1,
  pages: 1,
};

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

  // F15 web search: the persisted answer (trace + source chips).
  it('F15: a saved web answer shows a collapsed trace summary and numbered source chips', () => {
    useTabsStore.getState().setConversationHistory([
      { id: 'u1', role: 'user', content: 'q' },
      { id: 'a1', role: 'assistant', content: 'hello world', web: WEB },
    ]);
    const { container } = render(<MessageList />);

    const trace = container.querySelector('.web-steps')!;
    const summary = trace.querySelector('summary')!.textContent!;
    expect(summary).toContain('已联网搜索');
    expect(summary).toContain('1 次搜索');
    expect(summary).toContain('1 个网页');
    expect(trace).not.toHaveAttribute('open'); // a saved trace starts collapsed
    expect(trace.querySelectorAll('.web-step')).toHaveLength(2);
    expect(trace.querySelectorAll('.web-step.done')).toHaveLength(2);
    const card = trace.querySelector('.web-results a')!;
    expect(card.getAttribute('href')).toBe('https://a.test/1');
    expect(card.getAttribute('rel')).toContain('noopener');
    expect(trace.querySelector('.web-results')!.textContent).toContain('A one');
    expect(trace.querySelector('.web-results')!.textContent).toContain('A site');

    // Chips: 1-based numbers, in answer order, linking to their source in a new tab.
    const chips = [...container.querySelectorAll('.md-body .web-cite')] as HTMLElement[];
    expect(chips.map(c => c.textContent)).toEqual(['1', '2']);
    expect(chips[0]!.tagName).toBe('A');
    expect(chips[0]!.getAttribute('href')).toBe('https://a.test/1');
    expect(chips[0]!.getAttribute('target')).toBe('_blank');
    expect(chips[0]!.getAttribute('rel')).toContain('noopener');
    expect(chips[0]!.getAttribute('title')).toBe('A one');
    expect(chips[1]!.getAttribute('href')).toBe('https://b.test/2');
    // After "hello" (code point 5): the chip sits between the two words.
    expect(chips[0]!.previousSibling!.textContent).toBe('hello');

    // The marker is render-only: nothing private-use is left in the DOM and
    // the stored Markdown is untouched (copy / TTS / share read `content`).
    expect(container.querySelector('.md-body')!.textContent).not.toContain('\uE000');
    expect(core.getConversationHistory()[1]!.content).toBe('hello world');
  });

  it('F15: an answer that did not search has neither a trace nor chips', () => {
    useTabsStore.getState().setConversationHistory([{ id: 'a1', role: 'assistant', content: 'plain answer' }]);
    const { container } = render(<MessageList />);
    expect(container.querySelector('.web-steps')).toBeNull();
    expect(container.querySelector('.web-cite')).toBeNull();
  });

  it('F15: a source whose URL is not http(s) becomes a plain chip, never a link', () => {
    const web: WebResult = {
      ...WEB,
      steps: [{ id: 'c1', kind: 'search', action: { type: 'search', queries: ['q'] }, status: 'completed', sources: [{ url: 'javascript:alert(1)', title: 'bad' }] }],
      sources: [{ url: 'javascript:alert(1)', title: 'bad' }],
      citations: [{ start: 0, end: 3, source: 0 }],
    };
    useTabsStore.getState().setConversationHistory([{ id: 'a1', role: 'assistant', content: 'abc', web }]);
    const { container } = render(<MessageList />);

    const chip = container.querySelector('.md-body .web-cite')!;
    expect(chip.tagName).toBe('SPAN');
    expect(chip.hasAttribute('href')).toBe(false);
    const card = container.querySelector('.web-results')!.firstElementChild!;
    expect(card.tagName).toBe('LI');
    expect(card.querySelector('a')).toBeNull();
  });

  it('F15: paragraph chips and web chips render side by side', () => {
    useTabsStore.getState().setConversationHistory([{
      id: 'a1', role: 'assistant', content: 'x[#1]y',
      web: { ...WEB, sources: [{ url: 'https://a.test/1', title: 'A one' }], citations: [{ start: 0, end: 5, source: 0 }] },
    }]);
    const { container } = render(<MessageList />);
    expect(container.querySelectorAll('.citation-chip')).toHaveLength(1);
    expect(container.querySelector('.citation-chip')!.textContent).toBe('[#1]');
    expect(container.querySelectorAll('.web-cite')).toHaveLength(1);
  });

  it('F15: a failed search call is marked in the saved trace', () => {
    const web: WebResult = {
      ...WEB,
      steps: [{ id: 'c1', kind: 'search', action: { type: 'search', queries: ['q'] }, status: 'failed', error: 'url_not_accessible' }],
    };
    useTabsStore.getState().setConversationHistory([{ id: 'a1', role: 'assistant', content: 'abc', web }]);
    const { container } = render(<MessageList />);
    expect(container.querySelector('.web-step.failed')).not.toBeNull();
    expect(container.querySelector('.web-steps')!.textContent).toContain('失败：url_not_accessible');
  });

  // F15 web search: the live answer.
  it('F15: a running search shows in the live trace instead of the typing indicator', () => {
    useStreamStore.getState().start(42);
    useStreamStore.getState().addSearchEvent(42, {
      type: 'call_started', step: 0, call: { id: 'c1', index: 0, kind: 'deep_search', action: { type: 'search', queries: ['deepseek 最新模型', 'site:deepseek.com'] } },
    });
    const { container } = render(<MessageList />);

    const trace = container.querySelector('.web-steps')!;
    expect(trace.className).toContain('searching');
    expect(trace).toHaveAttribute('open'); // held open while live
    const summary = trace.querySelector('summary')!.textContent!;
    expect(summary).toContain('正在联网搜索');
    expect(summary).toContain('deepseek 最新模型');
    expect(container.querySelector('.web-step.running')).not.toBeNull();
    expect(container.querySelector('.typing-indicator')).toBeNull();
  });

  it('F15: the live trace switches to the summary once the calls complete', () => {
    useStreamStore.getState().start(42);
    const s = useStreamStore.getState();
    s.addSearchEvent(42, { type: 'call_started', step: 0, call: { id: 'c1', index: 0, kind: 'deep_search', action: { type: 'search', queries: ['q'] } } });
    s.addSearchEvent(42, { type: 'call_completed', step: 0, call: { id: 'c1', index: 0, status: 'completed', sources: [{ url: 'https://a.test/', title: 'A' }] } });
    s.appendAnswer(42, 'partial answer');
    const { container } = render(<MessageList />);

    const trace = container.querySelector('.web-steps')!;
    expect(trace.className).not.toContain('searching');
    expect(trace.querySelector('summary')!.textContent).toContain('已联网搜索 · 1 次搜索');
    expect(trace.textContent).toContain('1 条结果');
    expect(container.querySelector('.md-body')!.textContent).toContain('partial answer');
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

  // F15: the web search switch sits between the input and the send button.
  it('web search switch: on by default, and a click writes the setting', async () => {
    render(<Composer />);
    const on = () => screen.getByRole('button', { name: /联网搜索已开启/ });
    await vi.waitFor(() => expect(on()).toHaveAttribute('aria-pressed', 'true'));
    expect(on().className).toContain('on');
    // Nothing is stored until the user touches it — the default comes from SETTING_DEFAULTS.
    expect(store.sync.webSearch).toBeUndefined();

    fireEvent.click(on());
    expect(store.sync.webSearch).toBe(false);
    const off = screen.getByRole('button', { name: /联网搜索已关闭/ });
    expect(off).toHaveAttribute('aria-pressed', 'false');
    expect(off.className).not.toContain('on');

    fireEvent.click(off);
    expect(store.sync.webSearch).toBe(true);
    expect(screen.getByRole('button', { name: /联网搜索已开启/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('web search switch: follows a stored "off"', async () => {
    store.sync.webSearch = false;
    render(<Composer />);
    expect(await screen.findByRole('button', { name: /联网搜索已关闭/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('web search switch: sits right before the send button', async () => {
    render(<Composer />);
    await vi.waitFor(() => expect(document.querySelector('.web-btn.on')).not.toBeNull());
    const bar = document.querySelector('.input-wrapper')!;
    const kids = [...bar.children];
    const web = kids.findIndex(el => el.classList.contains('web-btn'));
    const send = kids.findIndex(el => el.classList.contains('send-btn'));
    expect(web).toBeGreaterThan(kids.findIndex(el => el.tagName === 'TEXTAREA'));
    expect(send).toBe(web + 1);
  });
});
