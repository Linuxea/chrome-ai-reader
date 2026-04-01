# Vite 模块化重构设计文档

## 目标

将 Chrome Extension (Manifest V3) 项目从全局脚本架构迁移到 Vite + ES Modules 模块化架构，解决：

- 全局作用域污染和隐式依赖
- 脚本加载顺序脆弱性
- 循环依赖（ui-helpers ↔ ai-chat, quick-commands ↔ ai-chat, suggest-questions ↔ ai-chat）
- 无法使用 npm 生态

## 决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 构建工具 | 手动 Vite 配置 | 入口结构简单（4 个独立上下文），可控性优先 |
| 语言 | 保持 JavaScript | 迁移成本最低，先跑通模块化 |
| 迁移策略 | 一次性迁移 | 改动面集中，避免长期维护两套结构 |
| 架构方案 | 领域分层 | 解决循环依赖，职责清晰，改动适中 |

## 目录结构

```
chrome-ai-reader/
├── src/
│   ├── side_panel/
│   │   ├── index.html           ← side_panel 入口 HTML
│   │   ├── main.js              ← 唯一 JS 入口：初始化模块 + 绑定事件
│   │   ├── state.js             ← 集中状态管理
│   │   ├── services/
│   │   │   ├── ai-chat.js       ← AI 对话核心逻辑
│   │   │   ├── tts.js           ← TTS 语音合成
│   │   │   └── ocr.js           ← OCR 图片处理
│   │   ├── ui/
│   │   │   ├── dom-helpers.js   ← DOM 操作工具函数
│   │   │   ├── theme.js         ← 主题切换
│   │   │   └── model-status.js  ← 模型状态栏
│   │   └── features/
│   │       ├── chat-history.js  ← 历史对话管理
│   │       ├── quick-commands.js← 快捷指令
│   │       ├── suggest-questions.js ← 推荐追问
│   │       ├── outline.js       ← 大纲生成
│   │       └── image-input.js   ← 图片输入处理
│   ├── content/
│   │   └── index.js             ← content script 入口
│   ├── background/
│   │   └── service-worker.js    ← service worker 入口
│   ├── options/
│   │   ├── index.html           ← options 页面
│   │   └── index.js             ← options 逻辑
│   └── shared/
│       ├── i18n.js              ← 国际化
│       └── constants.js         ← 共享常量和工具函数
├── public/
│   ├── icons/                   ← 扩展图标
│   └── manifest.json            ← Chrome Extension manifest
├── dist/                        ← Vite 构建输出（加载扩展时指向此目录）
├── vite.config.js
├── package.json
└── CLAUDE.md
```

## 依赖层次

```
Layer 0:  shared/        无项目依赖
Layer 1:  state.js       → shared/
Layer 2:  ui/            → shared/, state
Layer 3:  services/      → shared/, state, ui/
Layer 4:  features/      → shared/, state, ui/, services/
Entry:    main.js        → 所有层（连接回调，打破循环）
```

规则：**底层不依赖上层**。层间循环通过 main.js 中的回调注入打破。

## 状态管理

state.js 采用 getter/setter + 发布-订阅模式：

```js
// side_panel/state.js
let _isGenerating = false;
const listeners = new Map();

export function subscribe(key, callback) { /* ... */ }
function notify(key, value) { /* ... */ }

export function getIsGenerating() { return _isGenerating; }
export function setIsGenerating(v) {
  _isGenerating = v;
  notify('isGenerating', v);
}
```

状态字段列表（每个都有 get/set）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `pageContent` | string | 提取的页面内容 |
| `pageExcerpt` | string | 页面摘要 |
| `pageTitle` | string | 页面标题 |
| `conversationHistory` | Array | 对话历史（额外提供 push/splice/clear） |
| `isGenerating` | boolean | AI 是否正在生成 |
| `customSystemPrompt` | string | 用户自定义系统提示词 |
| `currentChatId` | string\|null | 当前对话 ID |
| `selectedText` | string | 用户选中的文本 |
| `activeTabId` | number\|null | 当前活动标签页 ID |
| `ocrRunning` | number | OCR 进行中计数 |
| `ocrResults` | Array | OCR 识别结果 |
| `imageIndex` | number | 图片自增索引 |
| `quickCommands` | Array | 用户自定义快捷指令 |
| `suggestQuestionsEnabled` | boolean | 是否自动生成追问 |

以下状态保留在各自模块内部，不放入 state.js（仅通过该模块的 getter 访问）：

| 状态 | 所在模块 | 导出 getter |
|---|---|---|
| `ttsPlaying` | services/tts.js | `isTTSPlaying()` |
| `ttsAutoPlayEnabled` | services/tts.js | `isTTSAutoPlay()` |
| `commandPopupOpen` | features/quick-commands.js | `isCommandPopupOpen()` |
| `commandSelectedIndex` | features/quick-commands.js | 内部使用 |
| TTS 内部状态（port, MediaSource 等） | services/tts.js | 不导出 |

`currentLang` 保留在 `shared/i18n.js` 中，通过 getter `getCurrentLang()` 导出（let 变量只能在定义模块内赋值）。

DOM 引用（chatArea, userInput 等）**不放入 state.js**，而是在 main.js 中获取后通过 init 函数注入给需要的模块。

## 循环依赖解决方案

### 循环 1：ui-helpers ↔ ai-chat

**问题：** ui-helpers 的 addUserActions 创建重试按钮需要调用 retryMessage（在 ai-chat 中），ai-chat 大量调用 ui-helpers 函数。

**解法：** ui 层通过回调参数接收行为，不 import service 层。

```js
// ui/dom-helpers.js
export function addUserActions(wrapper, msgEl, { onRetry }) {
  retryBtn.onclick = () => onRetry(wrapper, ...);
}

// services/ai-chat.js（上层依赖下层，正常）
import { addUserActions } from '../ui/dom-helpers.js';
addUserActions(wrapper, msgEl, { onRetry: retryMessage });
```

### 循环 2：quick-commands ↔ ai-chat

**问题：** quick-commands 调用 sendToAI，ai-chat 读取 commandPopupOpen。

**解法：** quick-commands 只导出状态查询，sendToAI 通过 main.js 注入。

```js
// features/quick-commands.js
export function executeCommand(cmd, sendFn) { sendFn(cmd.prompt, cmd.name); }

// main.js 中连接
// executeCommand 的 sendFn 参数指向 sendToAI
```

### 循环 3：suggest-questions ↔ ai-chat

**问题：** suggest-questions 点击建议时调用 sendMessage，ai-chat 调用 removeSuggestQuestions/generateSuggestions。

**解法：** suggest-questions 通过 init 回调接收 sendMessage。

```js
// features/suggest-questions.js
export function initSuggestQuestions({ chatArea, userInput, onSend }) {
  _onSendCallback = onSend;
}
```

## 模块接口设计

### shared/i18n.js

```js
// currentLang 是 let 变量，只能在 i18n.js 内部赋值
// 其他模块通过 getCurrentLang() 读取
let currentLang = 'zh';
export function getCurrentLang() { return currentLang; }
export function t(key, params) {}
export function loadLanguage(callback) {}
export function setLanguage(lang) {} // 内部修改 currentLang
export function applyTranslations() {}
```

### shared/constants.js

```js
export const TRUNCATE_LIMITS = { CONTEXT: 64000, QUOTE: 64000 };
export function safeTruncate(text, maxLen, suffix) {}
```

### side_panel/state.js

```js
// 每个 state 字段提供 getter/setter
export function subscribe(key, callback) {}

export function getPageContent() {}
export function setPageContent(v) {}
export function getPageExcerpt() {}
export function setPageExcerpt(v) {}
export function getPageTitle() {}
export function setPageTitle(v) {}
export function getConversationHistory() {}
export function setConversationHistory(v) {}
export function pushConversation(msg) {}
export function spliceConversation(...args) {}
export function clearConversation() {}
export function getIsGenerating() {}
export function setIsGenerating(v) {}
export function getCustomSystemPrompt() {}
export function setCustomSystemPrompt(v) {}
export function getCurrentChatId() {}
export function setCurrentChatId(v) {}
export function getSelectedText() {}
export function setSelectedText(v) {}
export function getActiveTabId() {}
export function setActiveTabId(v) {}
export function getOcrRunning() {}
export function setOcrRunning(v) {}
export function getOcrResults() {}
export function setOcrResults(v) {}
export function getImageIndex() {}
export function setImageIndex(v) {}
export function getQuickCommands() {}
export function setQuickCommands(v) {}
export function isSuggestQuestionsEnabled() {}
export function setSuggestQuestionsEnabled(v) {}
// 异步初始化：从 chrome.storage 读取初始值
export async function initState() {}
```

### ui/dom-helpers.js

```js
export function escapeHtml(text) {}
export function appendMessage(role, content, imageUris, callbacks) {}
export function appendMessageWithQuote(quoteStr, userText, imageUris, callbacks) {}
export function removeLastMessage() {}
export function addTypingIndicator(msgEl) {}
export function removeTypingIndicator(indicator) {}
export function scrollToBottom() {}
export function smartScrollToBottom() {}
export function setButtonsDisabled(disabled) {}
```

### ui/theme.js

```js
export function initTheme() {}
```

### ui/model-status.js

```js
export function updateModelStatusBar(name) {}
```

### services/ai-chat.js

```js
export function initAIChat({ chatArea, userInput, sendBtn, callbacks }) {}
export function extractPageContent() {}
export function handleQuickAction(action) {}
export function sendToAI(text, displayText, retryQuote, ocrContext, imageUris) {}
export function sendMessage() {}
export function retryMessage(wrapper, rawText, rawDisplay, rawQuote) {}
```

### services/tts.js

```js
export function initTTS({ chatArea }) {}
export function stopTTS() {}
export function initTTSPlayback() {}
export function ttsAppendChunk(content) {}
export function addTTSButton(msgEl) {}
export function initTTSAutoPlay(msgEl) {}
// 供其他模块查询 TTS 状态（内部变量不导出）
export function isTTSPlaying() {}
export function isTTSAutoPlay() {}
```

### services/ocr.js

```js
export function initOCR() {}
export function addImagePreview(index, fileName, dataUri) {}
export function runOCR(index, fileName, dataUri) {}
export function collectImageDataUris() {}
export function clearImagePreviews() {}
export function buildOcrContext() {}
export function hasImageErrors() {}
```

### features/chat-history.js

```js
export function initChatHistory({ chatArea, historyPanel, historyList, onLoadChat }) {}
// onLoadChat(chatData) 在加载历史对话时调用：
//   - chatData 包含 { id, title, messages, pageContent, pageExcerpt, pageTitle }
//   - 调用者负责更新 state 中的 currentChatId, pageContent 等
export function saveCurrentChat() {}
export function getDisplayMessages() {}
export function generateTitle(messages) {}
export function deleteChat(id) {}
export function loadChat(id) {}
export function renderHistoryList() {}
export function exportChatAsMarkdown(chatData) {}
```

### features/quick-commands.js

```js
export function initQuickCommands({ userInput, onSendToAI }) {}
export function isCommandPopupOpen() {}
export function getFilteredCommands(input) {}
export function updateCommandPopup(input) {}
export function renderCommandPopup(filtered) {}
export function hideCommandPopup() {}
```

### features/suggest-questions.js

```js
export function initSuggestQuestions({ chatArea, userInput, onSend }) {}
export function removeSuggestQuestions() {}
export function generateSuggestions(msgEl, history) {}
```

### features/outline.js

outline.js 有大量跨模块依赖（state, ui-helpers, tts, suggest-questions, chat-history, ai-chat），通过 init 注入回调：

```js
export function initOutline({
  // 从 services/ai-chat.js 注入
  onExtractPageContent,    // extractPageContent
  // 从 services/tts.js 注入
  onStopTTS,               // stopTTS
  onAddTTSButton,          // addTTSButton
  // 从 ui/dom-helpers.js 注入
  onAppendMessage,         // appendMessage
  onScrollToBottom,        // scrollToBottom
  onSetButtonsDisabled,    // setButtonsDisabled
  // 从 features/suggest-questions.js 注入
  onRemoveSuggestQuestions,// removeSuggestQuestions
  // 从 features/chat-history.js 注入
  onSaveCurrentChat,       // saveCurrentChat
}) {}
export function generateOutline() {}
export function renderOutlineFromJSON(data) {}
export function outlineToMarkdown(outline) {}
```

### features/image-input.js

```js
import { addImagePreview, runOCR } from '../services/ocr.js';
import { t } from '../../shared/i18n.js';

export function initImageInput({ userInput, imagePreviewBar }) {}
```

## Vite 配置

Chrome Extension 有四个独立的运行上下文，每个需要不同的构建策略：

| 上下文 | 入口类型 | 构建方式 | 说明 |
|---|---|---|---|
| side_panel | HTML 页面 | 标准 Vite HTML 入口 | `<script type="module">` 引用 main.js |
| options | HTML 页面 | 标准 Vite HTML 入口 | 同上 |
| content script | JS 脚本 | **IIFE 自执行 bundle** | Chrome content scripts 不支持 ES modules |
| service worker | JS 脚本 | **IIFE 自执行 bundle** | 需要 self-contained 单文件 |

### 关键点：content script 和 service worker 必须构建为 IIFE

Chrome content scripts 不支持 `"type": "module"`。Service worker 虽然支持 module type，但 Vite 的 code splitting 会产生多文件，导致 manifest 路径管理复杂。因此两者都构建为单个 IIFE（Immediately Invoked Function Expression）文件，所有依赖内联。

```js
// vite.config.js
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: 'inline', // 便于 Chrome DevTools 调试
    rollupOptions: {
      input: {
        // HTML 入口 — Vite 标准处理，支持 code splitting
        side_panel: resolve(__dirname, 'src/side_panel/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
        // JS 入口 — 需要特殊输出为 IIFE
        content: resolve(__dirname, 'src/content/index.js'),
        background: resolve(__dirname, 'src/background/service-worker.js'),
      },
      output: {
        // HTML 入口的产物
        entryFileNames: (chunkInfo) => {
          // content 和 background 构建为 IIFE，无 hash
          if (chunkInfo.name === 'content' || chunkInfo.name === 'background') {
            return '[name].js';
          }
          return '[name]/index.js';
        },
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name].[ext]',
        // 强制 content 和 background 为 IIFE 格式（不产生 import 语句）
        format: 'iife',
      },
    },
  },
});
```

**注意：** `format: 'iife'` 会应用于所有入口。对于 HTML 页面入口，Vite 实际使用自己的 module preload 机制，这个配置主要影响 content 和 background 的 JS 入口。如果 Vite 的全局 iife 格式影响 HTML 入口的正确性，需要使用自定义 Vite 插件仅对 content/background 入口应用 IIFE 格式，或者在 `writeBundle` 钩子中单独处理。

### 备选方案：多步构建

如果单次 Vite 构建无法同时满足 HTML 入口（需要 ESM）和 JS 入口（需要 IIFE）的需求，使用两次构建：

```json
// package.json
{
  "scripts": {
    "build": "vite build && node build-extension.js",
    "dev": "vite build --watch"
  }
}
```

`build-extension.js` 使用 Rollup API 单独打包 content 和 background 为 IIFE，放入 `dist/` 目录。Vite 主构建只处理两个 HTML 入口。

### manifest.json (public/)

manifest.json 放在 `public/` 中，Vite 会原样复制到 `dist/`。路径相对于 `dist/` 根目录：

```json
{
  "manifest_version": 3,
  "side_panel": { "default_path": "src/side_panel/index.html" },
  "options_page": "src/options/index.html",
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"]
  }],
  "background": {
    "service_worker": "background.js"
  }
}
```

**注意：** HTML 入口路径取决于 Vite 输出的实际目录结构。Vite 会保留 `src/` 下的相对路径结构，所以 `src/side_panel/index.html` 输出为 `dist/src/side_panel/index.html`。Content script 和 service worker 是 JS 入口，按 `entryFileNames` 输出为 `dist/content.js` 和 `dist/background.js`。

如果 Vite 的 HTML 输出路径与 manifest 不匹配，需要在 `vite.config.js` 的 `writeBundle` 钩子中调整，或者使用自定义插件重写 manifest 中的路径。

## 第三方库

| 库 | 当前方式 | 迁移后 |
|---|---|---|
| marked | libs/marked.min.js | `npm install marked` |
| Readability | libs/Readability.js | `npm install @mozilla/readability` |

`marked.setOptions({ breaks: true, gfm: true })` 在 `main.js` 中调用一次，确保所有模块使用统一配置。

## CSS 处理

CSS 文件保留在各自 HTML 入口旁边，通过 `<link>` 标签引入，Vite 会自动处理：

```
src/side_panel/
├── index.html          ← <link rel="stylesheet" href="side_panel.css">
├── side_panel.css      ← 主样式（含 CSS 自定义属性/主题变量）
├── history.css
├── quick-commands.css
├── outline.css
└── ...

src/options/
├── index.html          ← <link rel="stylesheet" href="options.css">
└── options.css
```

Vite 默认会将 CSS 提取为独立文件（与 HTML 入口同目录），不影响运行时行为。主题系统使用的 `[data-theme]` 和 `[data-theme-name]` CSS 属性选择器不需要任何修改。

## options 页面

options 页面是独立上下文，只需要 `shared/i18n.js`：

```js
// src/options/index.js
import { t, loadLanguage, setLanguage, applyTranslations } from '../shared/i18n.js';
// escapeHtml 复用 shared/constants.js 中的实现
import { escapeHtml } from '../shared/constants.js';

// options 页面的主题逻辑保持自包含（它有自己的主题管理 UI）
// 或者提取 theme 共享逻辑到 shared/theme-core.js（如果值得复用）
```

对于 options 页面特有的主题管理 UI（主题选择器），保持独立实现。side_panel 和 options 的暗色模式切换通过 `chrome.storage.onChanged` 同步，这个机制不变。

## 初始化顺序

main.js 中的初始化必须遵循特定顺序，因为某些模块依赖其他模块的初始化完成：

```js
// main.js 中的初始化顺序
async function init() {
  // 1. 语言（所有 t() 调用的前提）
  await loadLanguage();

  // 2. 共享配置（marked 等）
  marked.setOptions({ breaks: true, gfm: true });

  // 3. 主题（影响渲染，应在 UI 操作前）
  initTheme();

  // 4. 状态（从 chrome.storage 读取初始值）
  await initState({ chatArea }); // 读取 systemPrompt, activeTabId 等

  // 5. UI 层（不需要 async init）
  initModelStatus();
  // dom-helpers 不需要 init（纯函数）

  // 6. 服务层
  initTTS({ chatArea });
  initOCR();

  // 7. 功能层（可能依赖服务层已初始化）
  initChatHistory({ chatArea, historyPanel, historyList, onLoadChat: handleLoadChat });
  initQuickCommands({ userInput, onSendToAI: sendToAI });
  initSuggestQuestions({ chatArea, userInput, onSend: sendMessage });
  initOutline({
    onStopTTS: stopTTS,
    onRemoveSuggestQuestions: removeSuggestQuestions,
    onAppendMessage: appendMessage,
    onSetButtonsDisabled: setButtonsDisabled,
    onAddTTSButton: addTTSButton,
    onSaveCurrentChat: saveCurrentChat,
  });
  initImageInput({ userInput, imagePreviewBar });

  // 8. AI 聊天（最后，因为它依赖几乎所有其他模块的回调）
  initAIChat({
    chatArea, userInput, sendBtn, actionBtns,
    callbacks: { onRetry: retryMessage },
  });

  // 9. 事件绑定（在所有模块初始化后）
  bindGlobalEvents();
}

init();
```

注意：`chrome.storage.sync.get` 是异步的。`initState` 需要 await 从 storage 读取 `systemPrompt`、`activeTabId` 等。`initTheme` 也需要 await 读取 `darkMode` 和 `themeName`。这些可以并行：

```js
await Promise.all([
  loadLanguage(),
  initState(),
  initTheme(),
]);
```

后续的 init 调用大多是同步的（仅设置回调引用和事件监听器）。

## 开发工作流

| 操作 | 命令 |
|---|---|
| 开发（watch 模式） | `npm run dev` |
| 生产构建 | `npm run build` |
| 加载扩展 | `chrome://extensions` → "Load unpacked" → 选择 `dist/` |

开发时修改源文件后，watch 模式自动增量构建，然后在 `chrome://extensions` 中点击 reload 即可。

## 迁移步骤（概要）

1. 初始化 Vite 项目（package.json, vite.config.js, 目录结构）
2. 创建 shared/（i18n.js, constants.js）— 纯 export 改造
3. 创建 state.js — 集中全局变量
4. 迁移 ui/ 层（dom-helpers, theme, model-status）— 消除对 services 的依赖
5. 迁移 services/ 层（ai-chat, tts, ocr）— 改用 state getter/setter
6. 迁移 features/ 层（chat-history, quick-commands, suggest-questions, outline, image-input）
7. 创建 main.js — 连接所有模块，注入回调
8. 迁移 content/, background/, options/
9. 配置 manifest.json, HTML 入口文件
10. 端到端测试

## 功能不变性

重构过程中所有功能保持不变：

- AI 对话流式传输（SSE）
- TTS 语音合成（MediaSource 流式播放）
- OCR 图片识别
- 快捷指令（斜杠命令）
- 历史对话管理
- 推荐追问
- 大纲生成
- 主题切换（素笺/海洋/森林 + 暗色模式）
- 中英文双语
- 选中文本引用
- 图片粘贴/拖拽
