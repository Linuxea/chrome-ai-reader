# 视觉理解（Vision）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给"小🍐子阅读助手"加多模态视觉能力——勾选"模型支持视觉"后，点"视觉分析"按钮截当前 tab 可视区，截图以 `image_url` 发给视觉模型分析，可在同一聊天流里多轮追问。

**Architecture:** 复用现有 OpenAI 兼容协议与 ai-chat 端口。`ChatMessage.content` 从 `string` 升级为 `string | MessageContentPart[]`，视觉消息的图片以 OpenAI `image_url` 块进 content 数组。截图用 `chrome.tabs.captureVisibleTab`（side panel 直接调，`activeTab` 权限已够，无需新权限）。视觉开启时所有图片（截图+上传+粘贴+拖拽）走视觉，跳过现有 OCR；视觉关闭时走现有 OCR 兜底。图片仅内存态，写盘前剥离 `image_url` 块只留文字，重启后图片失效显示提示。

**Tech Stack:** TypeScript (strict), Vitest + jsdom, Chrome Extension MV3, OpenAI 兼容 chat/completions API。

**Spec:** `docs/superpowers/specs/2026-06-24-vision-understanding-design.md`

---

## 文件结构

| 文件 | 责任 | 动作 |
|---|---|---|
| `src/shared/types.ts` | `ChatMessage.content` 联合类型 + `MessageContentPart` + `hadImages` | 修改 |
| `src/shared/types.js` | JSDoc typedef 同步 | 修改 |
| `src/platform/tabs.ts` | `ActiveTab` 加 `windowId` 字段 | 修改 |
| `src/side_panel/services/screenshot.ts` | `captureVisibleTab()` 封装 | 新增 |
| `src/side_panel/services/ocr.ts` | `ingestImages` 视觉开启跳过 OCR；新增 `addImageDataUri` | 修改 |
| `src/side_panel/services/chat/history-ops.ts` | `appendMessage` 写盘剥离图片；新增 `stripImagesForPersistence` | 修改 |
| `src/side_panel/state.ts` | `persistForTab` 序列化时剥离图片 | 修改 |
| `src/side_panel/services/message-sender.ts` | `sendToAI` 视觉开启组装数组 content + 请求体软提示 | 修改 |
| `src/side_panel/ui/dom-helpers.ts` | `appendMessage` 渲染数组 content 图片块 + 重载态"图片已失效" | 修改 |
| `src/side_panel/index.html` | "视觉分析"按钮 | 修改 |
| `src/options/index.html` + 对应 `.ts` | "模型支持视觉"复选框 | 修改 |
| `src/shared/i18n.js` | 新 key (zh + en) | 修改 |
| `src/side_panel/main.ts` | 初始化截图按钮 + onSyncChange 联动显隐 | 修改 |
| `src/background/sw-openai.ts` | 核对 content 字符串假设，加守卫 | 修改 |

测试文件：

| 测试文件 | 覆盖 |
|---|---|
| `tests/services/chat/history-ops.test.ts` | 已有，扩充剥离用例 |
| `tests/services/ocr.test.js` | 已有，扩充视觉跳过 OCR 用例 |
| `tests/side_panel/services/screenshot.test.ts` | 新增 |
| `tests/shared/types.test.ts` | 新增（type 级，可选） |

---

## Task 1: ChatMessage 类型升级

**Files:**
- Modify: `src/shared/types.ts:23-33`
- Modify: `src/shared/types.js`

- [ ] **Step 1: 升级 `src/shared/types.ts` 的 ChatMessage**

在 `ChatMessage` interface 上方加 `MessageContentPart` 联合类型，并把 `content` 字段改为联合类型 + 加 `hadImages`：

```typescript
/**
 * 一个多模态内容块。视觉消息的 `content` 是此类型的数组；
 * 纯文字消息的 `content` 仍是 `string`。遵循 OpenAI 兼容格式。
 */
export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /**
   * 纯文字消息为 `string`；视觉/多模态消息为 `MessageContentPart[]`
   *（OpenAI 兼容格式：text 块 + image_url 块）。
   */
  content: string | MessageContentPart[];
  type?: string;
  /**
   * 仅内存态标记：该消息原本含图片，重启后图片已失效。
   * 持久化时仍保留此字段，用于重载后渲染"图片已失效"提示。
   */
  hadImages?: boolean;
  /** Tool calls emitted by the assistant (agent evolution — not yet wired). */
  tool_calls?: ToolCall[];
  /** When role is 'tool', the id of the tool call this result responds to. */
  tool_call_id?: string;
  /** Optional function/tool name (used with role 'tool' or 'assistant' tool_calls). */
  name?: string;
}
```

- [ ] **Step 2: 同步 `src/shared/types.js` 的 JSDoc typedef**

打开 `src/shared/types.js`，找到 ChatMessage 的 `@typedef`，把 `content` 字段类型注释更新为 `{string|Array<MessageContentPart>}`，并加 `hadImages` 字段。同时加 `MessageContentPart` 的 `@typedef`。具体内容先 Read 该文件再对应修改。

- [ ] **Step 3: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: PASS（无新错误。现有代码读 `msg.content` 当 string 用的地方会报类型错误——这些会在后续 Task 逐个修。**若 tsc 报错只来自于本计划后续 Task 会改的文件**（message-sender / history-ops / dom-helpers / sw-openai），记下错误数，继续；若来自其它文件，停下来排查。）

- [ ] **Step 4: 提交**

```bash
git add src/shared/types.ts src/shared/types.js
git commit -m "feat(vision): upgrade ChatMessage.content to support multimodal array"
```

---

## Task 2: 持久化剥离图片（history-ops + state）

**Files:**
- Modify: `src/side_panel/services/chat/history-ops.ts`
- Modify: `src/side_panel/state.ts:129-132`
- Test: `tests/services/chat/history-ops.test.ts`

- [ ] **Step 1: 先写失败测试——`stripImagesForPersistence` 剥离图片块**

在 `tests/services/chat/history-ops.test.ts` 末尾追加新 describe 块。先在文件顶部 import 里加 `stripImagesForPersistence`：

```typescript
import {
  rollbackTrailingUserMessage,
  truncateHistoryFromUserContent,
  appendMessage,
  stripImagesForPersistence,
} from '../../../src/side_panel/services/chat/history-ops';
```

在文件末尾（最后一个 `});` 之前）追加：

```typescript
  // ==========================================================================
  // stripImagesForPersistence
  // ==========================================================================
  describe('stripImagesForPersistence', () => {
    it('returns string-content messages unchanged', () => {
      const msg = { role: 'user' as const, content: 'hello' };
      expect(stripImagesForPersistence(msg)).toEqual(msg);
    });

    it('strips image_url blocks from array content, keeps text joined by newline', () => {
      const msg = {
        role: 'user' as const,
        content: [
          { type: 'text', text: '分析这张图' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,def' } },
        ],
        hadImages: true,
      };
      const out = stripImagesForPersistence(msg);
      expect(typeof out.content).toBe('string');
      expect(out.content).toBe('分析这张图');
      expect(out.hadImages).toBe(true);
    });

    it('joins multiple text blocks with newline', () => {
      const msg = {
        role: 'user' as const,
        content: [
          { type: 'text', text: '第一句' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,x' } },
          { type: 'text', text: '第二句' },
        ],
      };
      const out = stripImagesForPersistence(msg);
      expect(out.content).toBe('第一句\n第二句');
    });

    it('returns empty string content when array has no text blocks', () => {
      const msg = {
        role: 'user' as const,
        content: [
          { type: 'image_url', image_url: { url: 'data:image/png;base64,only' } },
        ],
      };
      const out = stripImagesForPersistence(msg);
      expect(out.content).toBe('');
    });
  });

  // ==========================================================================
  // appendMessage — persistence strips images (memory keeps originals)
  // ==========================================================================
  describe('appendMessage — vision message persistence', () => {
    it('keeps image_url blocks in memory conversationHistory', () => {
      const ts = makeTabState([]);
      const visionMsg = {
        role: 'user' as const,
        content: [
          { type: 'text', text: '看图' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,zzz' } },
        ],
        hadImages: true,
      };

      appendMessage(ts, visionMsg, TAB_ID);

      // 内存里保留原始带 image_url 的消息
      expect(ts.conversationHistory).toHaveLength(1);
      expect(Array.isArray(ts.conversationHistory[0].content)).toBe(true);
      expect(stateMock.persistForTab).toHaveBeenCalledWith(TAB_ID);
    });
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/services/chat/history-ops.test.ts`
Expected: FAIL — `stripImagesForPersistence is not a function` / import 失败。

- [ ] **Step 3: 实现 `stripImagesForPersistence` 并调整 `appendMessage`**

在 `src/side_panel/services/chat/history-ops.ts` 末尾追加。`appendMessage` 本身**不改**（它已经是 `push(msg) + persistForTab(tabId)`，内存保留原始 msg 正确）。剥离逻辑下沉到 `state.persistForTab`（Task 2 Step 4）。

```typescript
/**
 * Strip `image_url` blocks from a message's `content` array, keeping only the
 * text blocks joined by newlines. String content is returned unchanged.
 *
 * Used by `state.persistForTab` when serializing conversationHistory to
 * chrome.storage — images are memory-only (avoid storage quota blowup), so
 * the persisted form keeps just the text + a `hadImages` flag for reload-time
 * "image lost" rendering. Memory `conversationHistory` retains the original
 * array-form message so subsequent rounds can still send image_url to the model.
 */
export function stripImagesForPersistence(msg: ChatMessage): ChatMessage {
  if (typeof msg.content === 'string') return msg;
  const textParts = msg.content.filter(p => p.type === 'text');
  const text = textParts.map(p => p.text).join('\n');
  return { ...msg, content: text, hadImages: msg.hadImages };
}
```

- [ ] **Step 4: 调整 `state.persistForTab` 写盘时剥离图片**

读 `src/side_panel/state.ts:129-132`，现状：

```typescript
export function persistForTab(tabId: number): void {
  const ts = _tabStates.get(tabId);
  if (ts) chrome.storage.session.set({ [`tabState_${tabId}`]: ts });
}
```

改为（序列化时对 conversationHistory 跑 stripImagesForPersistence，内存不动）：

```typescript
import { stripImagesForPersistence } from './services/chat/history-ops';

export function persistForTab(tabId: number): void {
  const ts = _tabStates.get(tabId);
  if (!ts) return;
  const persistable: TabState = {
    ...ts,
    conversationHistory: ts.conversationHistory.map(stripImagesForPersistence),
  };
  chrome.storage.session.set({ [`tabState_${tabId}`]: persistable });
}
```

**注意循环依赖风险**：`history-ops.ts` import `state`，`state` 现在 import `history-ops`。这是循环。为避免，把 `stripImagesForPersistence` 挪到一个无依赖的纯函数模块 `src/side_panel/services/chat/strip-images.ts`，然后 `state` 和 `history-ops` 都从它 import。

修订：
- 新建 `src/side_panel/services/chat/strip-images.ts`：

```typescript
import type { ChatMessage } from '../../../shared/types';

/**
 * Strip `image_url` blocks from a message's `content` array, keeping only the
 * text blocks joined by newlines. String content is returned unchanged.
 *
 * Memory `conversationHistory` retains original array-form messages so
 * subsequent rounds can still send image_url to the model. Only the persisted
 * (storage) form is stripped — images are memory-only to avoid quota blowup.
 * `hadImages` is preserved so reload-time rendering can show "image lost".
 */
export function stripImagesForPersistence(msg: ChatMessage): ChatMessage {
  if (typeof msg.content === 'string') return msg;
  const textParts = msg.content.filter(p => p.type === 'text');
  const text = textParts.map(p => p.text).join('\n');
  return { ...msg, content: text, hadImages: msg.hadImages };
}
```

- `history-ops.ts` 从 `strip-images.ts` re-export（保持现有 import 签名不变，测试仍从 history-ops 导入）：

在 `history-ops.ts` 顶部加 `export { stripImagesForPersistence } from './strip-images';`

- `state.ts` import 从 `./services/chat/strip-images` 而非 `./services/chat/history-ops`，避免循环。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/services/chat/history-ops.test.ts`
Expected: PASS — 包括新增的 `stripImagesForPersistence` 4 个用例 + `appendMessage` 内存保留图片 1 个用例 + 原有所有用例。

- [ ] **Step 6: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: 无循环依赖类型错误。`strip-images.ts` 无依赖，`state.ts` 依赖它，`history-ops.ts` re-export 它——链路单向。

- [ ] **Step 7: 运行全部测试确认无回归**

Run: `npm run test`
Expected: PASS（829+ tests，原有全绿。state.test.js 可能因 persistForTab 行为变化有断言失败——若失败，更新测试里对 `chrome.storage.session.set` 参数的断言，使其期望剥离后的 conversationHistory。）

- [ ] **Step 8: 提交**

```bash
git add src/side_panel/services/chat/strip-images.ts \
        src/side_panel/services/chat/history-ops.ts \
        src/side_panel/state.ts \
        tests/services/chat/history-ops.test.ts
git commit -m "feat(vision): strip image_url blocks before persisting to storage"
```

---

## Task 3: 截图服务（新增 screenshot.ts）

**Files:**
- Create: `src/side_panel/services/screenshot.ts`
- Modify: `src/platform/tabs.ts:8-19`（`ActiveTab` 加 `windowId`）
- Test: `tests/side_panel/services/screenshot.test.ts`

- [ ] **Step 1: 扩展 `ActiveTab` 接口加 `windowId`**

`src/platform/tabs.ts:8-12` 现状：

```typescript
export interface ActiveTab {
  id: number | undefined;
  url: string | undefined;
  title: string | undefined;
}
```

改为：

```typescript
export interface ActiveTab {
  id: number | undefined;
  windowId: number | undefined;
  url: string | undefined;
  title: string | undefined;
}
```

`getActiveTab` 实现改为（`src/platform/tabs.ts:15-19`）：

```typescript
export async function getActiveTab(): Promise<ActiveTab> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  return { id: tab?.id, windowId: tab?.windowId, url: tab?.url, title: tab?.title };
}
```

- [ ] **Step 2: 先写失败测试**

新建 `tests/side_panel/services/screenshot.test.ts`：

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/platform/tabs.js', () => ({
  getActiveTab: vi.fn(),
}));

import { captureVisibleTab } from '../../../src/side_panel/services/screenshot';
import { getActiveTab } from '../../../src/platform/tabs.js';

describe('services/screenshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('captures the visible area of the active tab window', async () => {
    (getActiveTab as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 99, windowId: 7, url: 'https://example.com', title: 'Example',
    });
    const fakeDataUrl = 'data:image/png;base64,AAAA';
    vi.stubGlobal('chrome', {
      tabs: { captureVisibleTab: vi.fn().mockResolvedValue(fakeDataUrl) },
    });

    const result = await captureVisibleTab();

    expect(result).toBe(fakeDataUrl);
    expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledWith(7, { format: 'png' });
  });

  it('throws when there is no active tab windowId', async () => {
    (getActiveTab as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: undefined, windowId: undefined, url: undefined, title: undefined,
    });

    await expect(captureVisibleTab()).rejects.toThrow();
  });

  it('propagates captureVisibleTab rejection', async () => {
    (getActiveTab as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 1, windowId: 2, url: 'https://x.com', title: 'X',
    });
    vi.stubGlobal('chrome', {
      tabs: { captureVisibleTab: vi.fn().mockRejectedValue(new Error('permission denied')) },
    });

    await expect(captureVisibleTab()).rejects.toThrow('permission denied');
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/side_panel/services/screenshot.test.ts`
Expected: FAIL — `Cannot find module '../../../src/side_panel/services/screenshot'`。

- [ ] **Step 4: 实现 `src/side_panel/services/screenshot.ts`**

```typescript
import { getActiveTab } from '../../platform/tabs';

/**
 * Capture the currently visible area of the active tab as a PNG data URL.
 *
 * Called from the side panel — `chrome.tabs.captureVisibleTab` is available
 * to extension pages with the `activeTab` permission (already granted). No
 * `debugger` permission needed; no background relay needed.
 *
 * @returns PNG data URI (`data:image/png;base64,...`)
 * @throws if there is no active tab/window or capture is denied (e.g. on
 *         `chrome://` internal pages).
 */
export async function captureVisibleTab(): Promise<string> {
  const tab = await getActiveTab();
  if (tab.windowId === undefined) throw new Error('No active tab window');
  return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/side_panel/services/screenshot.test.ts`
Expected: PASS — 3 个用例全绿。

- [ ] **Step 6: 运行类型检查 + 全部测试**

Run: `npx tsc --noEmit && npm run test`
Expected: PASS。`platform/tabs.ts` 的 `ActiveTab` 改动可能影响 `tabs.test`（若存在），跑全测确认。

- [ ] **Step 7: 提交**

```bash
git add src/platform/tabs.ts src/side_panel/services/screenshot.ts \
        tests/side_panel/services/screenshot.test.ts
git commit -m "feat(vision): add captureVisibleTab screenshot service"
```

---

## Task 4: 图片 intake 分叉（ocr.ts 视觉开启跳过 OCR）

**Files:**
- Modify: `src/side_panel/services/ocr.ts`
- Test: `tests/services/ocr.test.js`

- [ ] **Step 1: 先写失败测试——`ingestImages` 视觉开启时不调 runOCR**

在 `tests/services/ocr.test.js` 里加新 import 和 mock。先把 `vi.mock` 部分扩展加 `storage`：

```javascript
vi.mock('../../src/platform/storage.js', () => ({
  getSync: vi.fn(() => Promise.resolve({})),
}));
```

在顶部 import 部分加：

```javascript
import { getSync } from '../../src/platform/storage.js';
```

并在 `import { ... } from '../../src/side_panel/services/ocr.js'` 里加 `ingestImages`、`addImageDataUri`：

```javascript
import {
  initOCR,
  runOCR,
  ingestImages,
  addImageDataUri,
  buildOcrContext,
  hasImageErrors,
  getOcrRunning,
} from '../../src/side_panel/services/ocr.js';
```

在文件末尾（最后一个 `});` 之前）追加新 describe 块：

```javascript
  describe('ingestImages — vision toggle', () => {
    it('does NOT run OCR when visionEnabled is true', async () => {
      getSync.mockResolvedValue({ visionEnabled: true });
      const bar = document.getElementById('imagePreviewBar');
      bar.classList.add('hidden');

      // 创建一个伪 File
      const file = new File(['dummy'], 'test.png', { type: 'image/png' });
      await ingestImages([file]);

      // 预览条应显示
      expect(bar.classList.contains('hidden')).toBe(false);
      // 应有一个预览项
      expect(bar.querySelectorAll('.image-preview-item').length).toBe(1);
      // 不应触发 OCR（chrome.runtime.sendMessage 不应被调用）
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('runs OCR when visionEnabled is false', async () => {
      getSync.mockResolvedValue({ visionEnabled: false });
      chrome.runtime.sendMessage.mockResolvedValue({ success: true, data: { text: 'ok' } });
      const bar = document.getElementById('imagePreviewBar');
      bar.classList.add('hidden');

      const file = new File(['dummy'], 'test.png', { type: 'image/png' });
      await ingestImages([file]);

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'ocrParse',
        file: expect.stringContaining('data:image/'),
      });
    });

    it('runs OCR when visionEnabled is absent (default off)', async () => {
      getSync.mockResolvedValue({});
      chrome.runtime.sendMessage.mockResolvedValue({ success: true, data: { text: 'ok' } });
      const bar = document.getElementById('imagePreviewBar');
      bar.classList.add('hidden');

      const file = new File(['dummy'], 'test.png', { type: 'image/png' });
      await ingestImages([file]);

      expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    });
  });

  describe('addImageDataUri — direct injection', () => {
    it('adds a screenshot data URI to preview bar without OCR', async () => {
      const bar = document.getElementById('imagePreviewBar');
      bar.classList.add('hidden');

      await addImageDataUri('data:image/png;base64,XXXX', '截图 2026-06-24 12:00');

      expect(bar.classList.contains('hidden')).toBe(false);
      expect(bar.querySelectorAll('.image-preview-item').length).toBe(1);
      const img = bar.querySelector('.image-thumb');
      expect(img.src).toBe('data:image/png;base64,XXXX');
      // 不调 OCR
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/services/ocr.test.js`
Expected: FAIL — `ingestImages` / `addImageDataUri` 未导出，或现有 `ingestImages` 不读 `visionEnabled`。

- [ ] **Step 3: 修改 `src/side_panel/services/ocr.ts`**

在文件顶部 import 加：

```typescript
import { getSync } from '../../platform/storage';
```

把 `ingestImages` 改为 async + 读 `visionEnabled`，并把 FileReader 回调包成 Promise。现状 `ocr.ts:36-51`：

```typescript
export function ingestImages(files: File[]): void {
  if (files.length === 0) return;
  _imagePreviewBar.classList.remove('hidden');
  files.forEach(file => {
    let idx = state.getImageIndex();
    idx++;
    state.setImageIndex(idx);
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUri = e.target?.result as string;
      addImagePreview(idx, file.name, dataUri);
      runOCR(idx, file.name, dataUri);
    };
    reader.readAsDataURL(file);
  });
}
```

改为：

```typescript
export async function ingestImages(files: File[]): Promise<void> {
  if (files.length === 0) return;
  _imagePreviewBar.classList.remove('hidden');
  const { visionEnabled } = await getSync<{ visionEnabled?: boolean }>(['visionEnabled']);
  const visionOn = visionEnabled === true;
  for (const file of files) {
    let idx = state.getImageIndex();
    idx++;
    state.setImageIndex(idx);
    const dataUri = await readAsDataURL(file);
    addImagePreview(idx, file.name, dataUri);
    if (!visionOn) runOCR(idx, file.name, dataUri);
  }
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Add a screenshot (or any pre-decoded image data URI) directly to the preview
 * bar without triggering OCR. Used by the "视觉分析" capture button —
 * screenshots are meant for the vision model, never for OCR.
 */
export async function addImageDataUri(dataUri: string, name: string): Promise<void> {
  _imagePreviewBar.classList.remove('hidden');
  let idx = state.getImageIndex();
  idx++;
  state.setImageIndex(idx);
  addImagePreview(idx, name, dataUri);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/services/ocr.test.js`
Expected: PASS — 新增 5 个用例 + 原有全绿。

- [ ] **Step 5: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: 无新错误（`ingestImages` 返回值从 `void` 变 `Promise<void>`，调用方 `features/image-input` 若没 await 会有 warning 但不是 error——检查并按需加 await）。

- [ ] **Step 6: 检查并更新 `features/image-input` 对 `ingestImages` 的调用**

Run: `grep -rn "ingestImages" src/`
找出所有调用点。若调用未 await，加 `await`（调用方需是 async）。若调用方不能是 async，用 `void ingestImages(...)` 显式标记 fire-and-forget。

- [ ] **Step 7: 运行全部测试**

Run: `npm run test`
Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add src/side_panel/services/ocr.ts tests/services/ocr.test.js \
        src/side_panel/features/image-input.ts
git commit -m "feat(vision): skip OCR when visionEnabled, add addImageDataUri for screenshots"
```

---

## Task 5: 发送分叉（message-sender.ts 组装多模态 content）

**Files:**
- Modify: `src/side_panel/services/message-sender.ts:27-124`
- Test: 新建 `tests/services/message-sender.test.ts`（若不存在）或扩充现有

- [ ] **Step 1: 读现有 `message-sender.ts` 全文确认行号**

Run: 读 `src/side_panel/services/message-sender.ts`（已在 spec 阶段读过，行号以当前文件为准）。`sendToAI` 在 27-124 行。

- [ ] **Step 2: 先写失败测试——视觉开启时组装数组 content**

新建 `tests/services/message-sender.test.ts`。这个测试较复杂，需要 mock state / page-extractor / stream-handler / dom-helpers / history-ops / storage。简化策略：只测 `sendToAI` 里"组装 messages 数组传给 callAI"的行为——mock `callAI` 捕获其收到的 messages 参数。

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/shared/i18n.js', () => ({
  t: (key: string) => `[${key}]`,
  getCurrentLang: () => 'zh',
}));
vi.mock('../../../src/shared/prompts', () => ({
  getPrompt: () => 'system-prompt',
}));
vi.mock('../../../src/shared/constants', () => ({
  TRUNCATE_LIMITS: { CONTEXT: 99999, QUOTE: 99999 },
  safeTruncate: (s: string) => s,
}));
vi.mock('../../../src/shared/utils', () => ({
  toErrorMessage: (e: unknown) => String(e),
}));
vi.mock('../../../src/side_panel/state.js', () => ({
  getActiveTabId: vi.fn(() => 42),
  getStateForTab: vi.fn(() => ({
    pageContent: 'page text',
    pageTitle: 'Title',
    pageExcerpt: '',
    conversationHistory: [],
    currentChatId: null,
    selectedText: '',
    isGenerating: false,
    isPodcastGenerating: false,
    ocrRunning: 0,
    ocrResults: [],
    imageIndex: 0,
  })),
  persistForTab: vi.fn(),
  setIsGenerating: vi.fn(),
  getCustomSystemPrompt: vi.fn(() => ''),
}));
vi.mock('../../../src/side_panel/events.js', () => ({
  emit: vi.fn(),
  EVENTS: { REMOVE_SUGGEST_QUESTIONS: 'x', CLEAR_QUOTE_PREVIEW: 'y' },
}));
vi.mock('../../../src/side_panel/ui/dom-helpers.js', () => ({
  appendMessage: vi.fn(() => document.createElement('div')),
  appendMessageWithQuote: vi.fn(() => document.createElement('div')),
  removeLastMessage: vi.fn(),
  setButtonsDisabled: vi.fn(),
}));
vi.mock('../../../src/side_panel/services/tts/index.js', () => ({
  isTTSPlaying: () => false,
  stopTTS: vi.fn(),
}));
vi.mock('../../../src/side_panel/services/ocr.js', () => ({
  hasImageErrors: () => false,
  buildOcrContext: () => '',
  collectImageDataUris: vi.fn(() => []),
  clearImagePreviews: vi.fn(),
  validateImageState: () => null,
}));
vi.mock('../../../src/side_panel/services/page-extractor.js', () => ({
  ensurePageContent: vi.fn(() => ({ ok: true, value: undefined })),
}));
vi.mock('../../../src/side_panel/services/stream-handler.js', () => ({
  callAI: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/side_panel/services/chat/history-ops.js', () => ({
  appendMessage: vi.fn(),
  rollbackTrailingUserMessage: vi.fn(),
  truncateHistoryFromUserContent: vi.fn(),
}));
vi.mock('../../../src/platform/storage.js', () => ({
  getSync: vi.fn(),
}));

import { sendToAI } from '../../../src/side_panel/services/message-sender';
import { callAI } from '../../../src/side_panel/services/stream-handler.js';
import { getSync } from '../../../src/platform/storage.js';
import { appendMessage as appendHistory } from '../../../src/side_panel/services/chat/history-ops.js';

describe('services/message-sender — sendToAI vision fork', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getSync as ReturnType<typeof vi.fn>).mockResolvedValue({ visionEnabled: false });
  });

  it('builds array content with image_url blocks when visionEnabled + images present', async () => {
    (getSync as ReturnType<typeof vi.fn>).mockResolvedValue({ visionEnabled: true });
    const img1 = 'data:image/png;base64,AAA';
    const img2 = 'data:image/png;base64,BBB';

    await sendToAI('分析这些图', '分析这些图', undefined, '', [img1, img2]);

    const messagesArg = (callAI as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const lastMsg = messagesArg[messagesArg.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(Array.isArray(lastMsg.content)).toBe(true);
    const parts = lastMsg.content;
    expect(parts[0]).toEqual({ type: 'text', text: '分析这些图' });
    expect(parts[1]).toEqual({ type: 'image_url', image_url: { url: img1 } });
    expect(parts[2]).toEqual({ type: 'image_url', image_url: { url: img2 } });
    expect(lastMsg.hadImages).toBe(true);

    // history append 收到原始带图消息
    const historyArg = (appendHistory as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(Array.isArray(historyArg.content)).toBe(true);
  });

  it('builds string content when visionEnabled is false (OCR fallback path)', async () => {
    (getSync as ReturnType<typeof vi.fn>).mockResolvedValue({ visionEnabled: false });

    await sendToAI('总结', '总结', undefined, 'OCR_TEXT', []);

    const messagesArg = (callAI as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const lastMsg = messagesArg[messagesArg.length - 1];
    expect(typeof lastMsg.content).toBe('string');
    expect(lastMsg.content).toContain('总结');
    expect(lastMsg.content).toContain('OCR_TEXT');
  });

  it('builds string content when visionEnabled but no images', async () => {
    (getSync as ReturnType<typeof vi.fn>).mockResolvedValue({ visionEnabled: true });

    await sendToAI('纯文字提问', '纯文字提问', undefined, '', []);

    const messagesArg = (callAI as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const lastMsg = messagesArg[messagesArg.length - 1];
    expect(typeof lastMsg.content).toBe('string');
    expect(lastMsg.content).toBe('纯文字提问');
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/services/message-sender.test.ts`
Expected: FAIL — 现有 `sendToAI` 不读 `visionEnabled`，永远走字符串路径。第一个用例 fail（content 是 string 不是 array）。

- [ ] **Step 4: 修改 `src/side_panel/services/message-sender.ts` 的 `sendToAI`**

顶部 import 加：

```typescript
import { getSync } from '../../platform/storage';
import type { MessageContentPart } from '../../shared/types';
```

`sendToAI` 函数体改动（以现状 27-124 行为基础）。**关键：保留所有现有逻辑（quoteForContext 拼接、system 消息组装、conversationHistory push、catch 块），只在"组装最后一条 user message"处分叉**。

把现状的这段（`message-sender.ts:94-110`）：

```typescript
    let historyContent = text;
    let apiContent = text;

    if (quoteForContext) {
      const quote = safeTruncate(quoteForContext, TRUNCATE_LIMITS.QUOTE, t('ai.quoteTruncated'));
      const withQuote = t('ai.quotePrefix') + '\n\n' + quote + '\n\n' + text;
      historyContent = withQuote;
      apiContent = withQuote;
    }

    appendHistory(tabState, { role: 'user', content: historyContent }, startTabId!);

    if (ocrContext) {
      apiContent = apiContent + '\n\n' + ocrContext;
    }
    messages.push({ role: 'user', content: apiContent });

    await callAI(messages, startTabId);
```

改为：

```typescript
    let apiContent = text;

    if (quoteForContext) {
      const quote = safeTruncate(quoteForContext, TRUNCATE_LIMITS.QUOTE, t('ai.quoteTruncated'));
      const withQuote = t('ai.quotePrefix') + '\n\n' + quote + '\n\n' + text;
      apiContent = withQuote;
    }

    const { visionEnabled } = await getSync<{ visionEnabled?: boolean }>(['visionEnabled']);
    const visionOn = visionEnabled === true;
    const hasImages = visionOn && imageUris !== undefined && imageUris.length > 0;

    let userMessage: ChatMessage;
    if (hasImages) {
      const parts: MessageContentPart[] = [];
      if (apiContent) parts.push({ type: 'text', text: apiContent });
      for (const uri of imageUris!) parts.push({ type: 'image_url', image_url: { url: uri } });
      userMessage = { role: 'user', content: parts, hadImages: true };
    } else {
      if (ocrContext) apiContent = apiContent + '\n\n' + ocrContext;
      userMessage = { role: 'user', content: apiContent };
    }
    messages.push(userMessage);
    appendHistory(tabState, userMessage, startTabId!);

    if (hasImages) {
      const totalBytes = imageUris!.reduce((sum, u) => sum + u.length, 0);
      if (totalBytes > 10 * 1024 * 1024) {
        appendMessage('error', t('error.visionPayloadTooLarge'));
      }
    }

    await callAI(messages, startTabId);
```

**注意**：删掉了 `historyContent` 变量（视觉路径下持久化由 `stripImagesForPersistence` 处理，文字路径下 `apiContent` 就是历史内容）。确认 `appendHistory` 调用现在传 `userMessage`（可能含图片），`state.persistForTab` 会在写盘时剥离。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/services/message-sender.test.ts`
Expected: PASS — 3 个用例全绿。

- [ ] **Step 6: 运行类型检查 + 全部测试**

Run: `npx tsc --noEmit && npm run test`
Expected: PASS。注意 `message-sender` 的 `appendHistory` import 别名（`import { appendMessage as appendHistory } from ...`）保持不变。

- [ ] **Step 7: 提交**

```bash
git add src/side_panel/services/message-sender.ts tests/services/message-sender.test.ts
git commit -m "feat(vision): sendToAI assembles multimodal content array when vision enabled"
```

---

## Task 6: 聊天气泡渲染数组 content + 重载态"图片已失效"

**Files:**
- Modify: `src/side_panel/ui/dom-helpers.ts:23-50`
- Test: `tests/side_panel/ui/dom-helpers.test.js`（若存在）或新增

- [ ] **Step 1: 读现有 dom-helpers 测试确认风格**

Run: `ls tests/side_panel/ui/`
若 `dom-helpers.test.js` 存在，读它确认 mock 风格；若不存在，新建 `tests/side_panel/ui/dom-helpers.test.ts`。

- [ ] **Step 2: 先写失败测试——渲染数组 content 的图片 + 重载态"图片已失效"**

在 `tests/side_panel/ui/dom-helpers.test.js`（或新文件）里加用例。先确认现有 import 与 mock 设置，然后追加：

```javascript
  describe('appendMessage — multimodal content rendering', () => {
    it('extracts image_url blocks from array content and renders thumbnails', () => {
      // 需要先 initDOMHelpers
      document.body.innerHTML = '<div id="chatArea"></div>';
      const chatArea = document.getElementById('chatArea');
      const sendBtn = document.createElement('button');
      initDOMHelpers({ chatArea, actionBtns: [], sendBtn });

      const msg = {
        role: 'user',
        content: [
          { type: 'text', text: '看这张图' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,ABC' } },
        ],
      };
      // appendMessage 接收 ChatMessage 或 (role, content, imageUris) 两种签名之一
      // 这里测"从 ChatMessage 渲染"的新重载——见 Step 4 的实现
      const div = appendMessageFromHistory(msg);

      // 应有文字
      expect(div.textContent).toContain('看这张图');
      // 应有缩略图
      const imgs = div.querySelectorAll('img.bubble-img-thumb');
      expect(imgs.length).toBe(1);
      expect(imgs[0].src).toBe('data:image/png;base64,ABC');
    });

    it('shows "image lost" hint when hadImages=true but content is string (reload state)', () => {
      document.body.innerHTML = '<div id="chatArea"></div>';
      const chatArea = document.getElementById('chatArea');
      const sendBtn = document.createElement('button');
      initDOMHelpers({ chatArea, actionBtns: [], sendBtn });

      const msg = {
        role: 'user',
        content: '原本有图的文字',
        hadImages: true,
      };
      const div = appendMessageFromHistory(msg);

      expect(div.textContent).toContain('原本有图的文字');
      expect(div.querySelector('.image-lost-hint')).not.toBeNull();
    });
  });
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/side_panel/ui/dom-helpers.test.js`
Expected: FAIL — `appendMessageFromHistory` 未导出。

- [ ] **Step 4: 在 `dom-helpers.ts` 加 `appendMessageFromHistory` + 辅助函数**

在 `src/side_panel/ui/dom-helpers.ts` 顶部 import 加：

```typescript
import type { ChatMessage, MessageContentPart } from '../../shared/types';
```

在文件末尾追加：

```typescript
/**
 * Render a chat message from `conversationHistory` (memory or reloaded from
 * storage) into the chat area. Handles both string content (plain text) and
 * array content (multimodal — extracts image_url thumbnails). On reload,
 * `hadImages: true` with string content means images were stripped at
 * persistence time → show an "image lost" hint.
 */
export function appendMessageFromHistory(msg: ChatMessage): HTMLDivElement {
  const imageUris = extractImageUrisFromContent(msg);
  const text = extractTextFromContent(msg);
  const role = msg.role === 'assistant' ? 'ai' : msg.role;
  const div = appendMessage(role, text, imageUris);

  if (msg.hadImages && imageUris.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'image-lost-hint';
    hint.textContent = t('error.imageLostAfterReload');
    div.insertBefore(hint, div.firstChild);
  }
  return div;
}

export function extractImageUrisFromContent(msg: ChatMessage): string[] {
  if (typeof msg.content === 'string') return [];
  return msg.content
    .filter((p): p is Extract<MessageContentPart, { type: 'image_url' }> => p.type === 'image_url')
    .map(p => p.image_url.url);
}

function extractTextFromContent(msg: ChatMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  return msg.content
    .filter((p): p is Extract<MessageContentPart, { type: 'text' }> => p.type === 'text')
    .map(p => p.text)
    .join('\n');
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/side_panel/ui/dom-helpers.test.js`
Expected: PASS。

- [ ] **Step 6: 运行类型检查 + 全部测试**

Run: `npx tsc --noEmit && npm run test`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/side_panel/ui/dom-helpers.ts tests/side_panel/ui/dom-helpers.test.js
git commit -m "feat(vision): render multimodal content + image-lost hint on reload"
```

---

## Task 7: i18n 新增 key（zh + en）

**Files:**
- Modify: `src/shared/i18n.js`

- [ ] **Step 1: 读现有 i18n.js 确认结构**

读 `src/shared/i18n.js`，找到 zh 和 en 两个对象的结构。新 key 要加到两个语言里。

- [ ] **Step 2: 加新 key**

在 zh 对象里加（按字母位置插入或末尾）：

```javascript
// vision 相关
'settings.vision.enabled': '模型支持视觉能力',
'settings.vision.hint': '勾选后需使用 OpenAI 兼容的视觉模型（如 gpt-4o、qwen-vl）',
'sidebar.visionCapture': '视觉分析',
'error.screenshotFailed': '截图失败',
'error.visionPayloadTooLarge': '图片过多可能发送失败，建议分多轮对话',
'error.imageLostAfterReload': '图片已在重启后丢失',
```

在 en 对象里加：

```javascript
'settings.vision.enabled': 'Model supports vision',
'settings.vision.hint': 'Requires an OpenAI-compatible vision model (e.g. gpt-4o, qwen-vl)',
'sidebar.visionCapture': 'Vision analyze',
'error.screenshotFailed': 'Screenshot failed',
'error.visionPayloadTooLarge': 'Too many images may fail to send; try splitting across turns',
'error.imageLostAfterReload': 'Image lost after reload',
```

- [ ] **Step 3: 运行 i18n 相关测试**

Run: `npm run test`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add src/shared/i18n.js
git commit -m "feat(vision): add i18n keys for vision settings and errors"
```

---

## Task 8: 设置页加"模型支持视觉"复选框

**Files:**
- Modify: `src/options/index.html`
- Modify: 对应的 `src/options/` 下 `.ts`（需先读结构确认文件名）

- [ ] **Step 1: 读 options 目录结构确认文件**

Run: `ls src/options/`
读 `src/options/index.html` 和对应的 `.ts` 入口，找到"模型设置"区的 HTML 和绑定代码位置。

- [ ] **Step 2: 在 index.html 模型设置区加复选框**

在 `apiBase` / `apiKey` / `modelName` 输入框附近加：

```html
<label class="setting-row">
  <input type="checkbox" id="visionEnabled" />
  <span data-i18n="settings.vision.enabled">模型支持视觉能力</span>
</label>
<p class="setting-hint" data-i18n="settings.vision.hint">
  勾选后需使用 OpenAI 兼容的视觉模型（如 gpt-4o、qwen-vl）
</p>
```

- [ ] **Step 3: 在 options 的 .ts 里绑定 visionEnabled 到 storage**

读现有 options `.ts` 里 `apiBase`/`modelName` 等字段如何 load/save（通常是 `getSync` 读初值 + `onchange` 调 `setSync`）。照同样模式加：

```typescript
const visionEnabledEl = document.getElementById('visionEnabled') as HTMLInputElement;
const stored = await getSync<{ visionEnabled?: boolean }>(['visionEnabled']);
visionEnabledEl.checked = stored.visionEnabled === true;
visionEnabledEl.addEventListener('change', () => {
  setSync({ visionEnabled: visionEnabledEl.checked });
});
```

- [ ] **Step 4: 运行类型检查 + 测试**

Run: `npx tsc --noEmit && npm run test`
Expected: PASS。

- [ ] **Step 5: 手动验证（若可能）**

`npm run build` → 加载 `dist/` → 打开设置页 → 勾选/取消"模型支持视觉能力" → 关闭再开设置页确认状态保留。

- [ ] **Step 6: 提交**

```bash
git add src/options/index.html src/options/**/*.ts
git commit -m "feat(vision): add visionEnabled checkbox in options page"
```

---

## Task 9: side panel 加"视觉分析"按钮 + 初始化 + onSyncChange 联动

**Files:**
- Modify: `src/side_panel/index.html:127`（紧挨 imageUploadBtn）
- Modify: `src/side_panel/main.ts`

- [ ] **Step 1: 在 `index.html` 紧挨 `imageUploadBtn` 之前加按钮**

在 `src/side_panel/index.html` 找到 `<button id="imageUploadBtn" ...>`（第 127 行），在它前面加：

```html
        <button id="visionCaptureBtn" class="icon-btn upload-btn hidden" data-i18n-title="sidebar.visionCapture" title="视觉分析">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
            <circle cx="12" cy="13" r="4"></circle>
          </svg>
        </button>
```

- [ ] **Step 2: 在 `main.ts` 加初始化与 onSyncChange 联动**

顶部 import 加：

```typescript
import { getSync, onSyncChange } from '../platform/storage';
import { captureVisibleTab } from './services/screenshot';
import { addImageDataUri } from './services/ocr.js';
import { appendMessage } from './ui/dom-helpers';
```

在 `init()` 函数里 `initOCR()` 之后加：

```typescript
  // 视觉分析按钮：显隐由 visionEnabled 控制
  const visionCaptureBtn = document.getElementById('visionCaptureBtn')!;
  const { visionEnabled } = await getSync<{ visionEnabled?: boolean }>(['visionEnabled']);
  if (visionEnabled) visionCaptureBtn.classList.remove('hidden');

  onSyncChange('visionEnabled', (val) => {
    if (val === true) visionCaptureBtn.classList.remove('hidden');
    else visionCaptureBtn.classList.add('hidden');
  });

  visionCaptureBtn.addEventListener('click', async () => {
    try {
      const dataUri = await captureVisibleTab();
      const name = `截图 ${new Date().toLocaleString()}`;
      await addImageDataUri(dataUri, name);
    } catch (e) {
      appendMessage('error', t('error.screenshotFailed') + (e instanceof Error ? `：${e.message}` : ''));
    }
  });
```

**注意**：`t` 需 import：`import { t } from '../shared/i18n.js';`（检查 main.ts 是否已 import，若无则加）。

- [ ] **Step 3: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 4: 运行全部测试**

Run: `npm run test`
Expected: PASS。

- [ ] **Step 5: 手动验证**

`npm run build` → 加载 `dist/` → 设置页勾选"模型支持视觉" → 侧边栏出现相机按钮 → 点按钮 → 截图进预览条 → 可敲文字 → 发送 → 视觉模型回复。

- [ ] **Step 6: 提交**

```bash
git add src/side_panel/index.html src/side_panel/main.ts
git commit -m "feat(vision): add vision capture button with live onSyncChange toggle"
```

---

## Task 10: sw-openai.ts 核对 content 字符串假设

**Files:**
- Modify: `src/background/sw-openai.ts`（视核对结果，可能无需改）

- [ ] **Step 1: 读 sw-openai.ts 找所有读 content 的位置**

Run: 读 `src/background/sw-openai.ts`，搜索 `.content` 的所有用法。重点找：
- 是否对 `content` 做了 `.slice()` / `.length` / 字符串拼接
- `max_tokens` 估算是否依赖 content 长度
- 构造 fetch body 是否直接 `JSON.stringify(messages)`（若是，数组 content 原生支持）

- [ ] **Step 2: 按需加类型守卫**

若找到 `msg.content.slice(...)` 或类似字符串假设，加 `if (typeof msg.content === 'string')` 守卫。若 fetch body 是 `JSON.stringify(messages)` 直接透传，则无需改。

预期最可能的情况：sw-openai.ts 直接 `JSON.stringify` 透传，无需改动。此 Task 的主要产出是"核对确认"。

- [ ] **Step 3: 运行类型检查 + sw-openai 测试**

Run: `npx tsc --noEmit && npx vitest run tests/background/`
Expected: PASS。若有 sw-openai.test.ts，确认它用 string content 的现有用例仍绿。

- [ ] **Step 4: 提交（若有改动）**

```bash
git add src/background/sw-openai.ts
git commit -m "fix(vision): guard string assumptions on ChatMessage.content in sw-openai"
```

若无需改动，跳过提交，在此 Task 末尾记录"核对完成，sw-openai.ts 直接透传 JSON.stringify，数组 content 原生支持"。

---

## Task 11: 全量回归 + lint + typecheck

**Files:** 无新改动

- [ ] **Step 1: 运行 lint**

Run: `npm run lint`
Expected: PASS。若有 warning（非 error）可接受；若有 error 必须修。

- [ ] **Step 2: 运行 typecheck**

Run: `npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 3: 运行全部测试**

Run: `npm run test`
Expected: PASS（原有 829+ + 新增用例全绿）。

- [ ] **Step 4: 运行循环依赖检查**

Run: `npx madge --circular --extensions ts,js src/`
Expected: 无新增循环依赖。`state.ts` ↔ `strip-images.ts` 是单向（strip-images 无依赖，state 依赖它），不应成环。若出现新环，排查 `history-ops` re-export 是否引入了环。

- [ ] **Step 5: 完整手动验证**

`npm run build` → 加载 `dist/`：
1. 设置页勾选"模型支持视觉" → 侧边栏出现相机按钮
2. 点相机按钮 → 截图进预览条（无 OCR 调用）
3. 敲文字"分析这张图" → 发送 → 视觉模型回复
4. 继续在输入框文字追问 → 模型基于上下文回复
5. 滚动页面 → 再点相机按钮 → 第二张图进预览条 → 发送 → 模型看到两张图
6. 取消勾选"模型支持视觉" → 相机按钮消失 → 上传图片走 OCR（现有流程不变）
7. 关闭侧边栏再开 → 视觉对话文字还在，图片显示"图片已失效"

- [ ] **Step 6: 最终提交（若有 fixup）**

```bash
git add -A
git commit -m "chore(vision): final regression pass"
```

---

## Self-Review 记录

**Spec 覆盖检查：**
- §1.2 目标（截图按钮、视觉开启跳过 OCR、多轮、未勾选不变）→ Task 4/5/9 ✓
- §2 决策（captureVisibleTab、image_url 格式、复用主聊天模型、图片不持久化、不硬限张数）→ Task 3/5/2 ✓
- §4.1 配置变更（visionEnabled + 设置页复选框 + onSyncChange）→ Task 8/9 ✓
- §4.2 ChatMessage 类型升级 → Task 1 ✓
- §4.3 协议层无结构改动 → 无需 Task（类型自动变宽）✓
- §4.4 截图服务 → Task 3 ✓
- §4.5 intake 分叉 + addImageDataUri → Task 4 ✓
- §4.6 视觉分析按钮 → Task 9 ✓
- §4.7 发送分叉 → Task 5 ✓
- §4.8 持久化剥离 → Task 2 ✓
- §4.9 聊天气泡渲染 → Task 6 ✓
- §4.10 sw-openai 核对 → Task 10 ✓
- §5 错误处理（截图失败/模型错误/请求体过大/重载图片丢失）→ Task 9/5/6 ✓
- §6 测试要点 → 各 Task 内嵌测试 ✓

**Placeholder 扫描：** 无 TBD/TODO；所有步骤有具体代码或具体命令。

**类型一致性：** `MessageContentPart` / `stripImagesForPersistence` / `addImageDataUri` / `captureVisibleTab` / `appendMessageFromHistory` / `extractImageUrisFromContent` 在各 Task 间签名一致。`getSync<{ visionEnabled?: boolean }>(['visionEnabled'])` 调用形式统一。
