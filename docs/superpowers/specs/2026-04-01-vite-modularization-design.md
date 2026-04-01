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
export let currentLang;
export function t(key, params) {}
export function loadLanguage(callback) {}
export function setLanguage(lang) {}
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

```js
export function initOutline() {}
export function generateOutline() {}
export function renderOutlineFromJSON(data) {}
export function outlineToMarkdown(outline) {}
```

### features/image-input.js

```js
export function initImageInput({ userInput, imagePreviewBar }) {}
```

## Vite 配置

```js
// vite.config.js
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        side_panel: resolve(__dirname, 'src/side_panel/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
        content: resolve(__dirname, 'src/content/index.js'),
        background: resolve(__dirname, 'src/background/service-worker.js'),
      },
      output: {
        entryFileNames: '[name]/index.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
```

### manifest.json (public/)

```json
{
  "manifest_version": 3,
  "side_panel": { "default_path": "side_panel/index.html" },
  "options_page": "options/index.html",
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content/index.js"]
  }],
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  }
}
```

## 第三方库

| 库 | 当前方式 | 迁移后 |
|---|---|---|
| marked | libs/marked.min.js | `npm install marked` |
| Readability | libs/Readability.js | `npm install @mozilla/readability` |

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
