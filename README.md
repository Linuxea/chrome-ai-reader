# 小🍐子阅读助手

> AI 驱动的 Chrome 网页阅读助手 — 支持总结、翻译、关键信息提取和自由问答

![产品截图](assets/ScreenShot_2026-03-29_151220_807.png)

## 功能特性

### 核心功能
- **一键总结** — 快速生成网页或选区内容摘要，3-5 个要点概括核心信息
- **全文翻译** — 将外文网页或选区内容翻译为中文，专业术语保留英文并附注释
- **关键信息提取** — 自动提取网页或选区中的重要事实、数据和观点
- **自由问答** — 基于当前页面内容进行多轮对话问答
- **推理过程展示** — 支持展示推理模型的思考过程（可折叠）

### 选区与引用
- **选区引用** — 选中页面文字后自动预览，快捷操作自动切换为针对选区内容处理
- **引用预览** — 输入框上方显示选中文本预览，可手动清除
- **消息引用** — 用户消息气泡中显示引用的 blockquote

### 快捷指令
- **自定义指令** — 在设置中配置快捷指令，输入 `/` 即可快速调用
- **键盘导航** — `↑`/`↓` 切换选中、`Enter` 执行、`Esc` 关闭
- **实时筛选** — 输入指令名前缀快速过滤

### 流式与交互
- **流式输出** — 实时显示 AI 回复，支持推理模型的思考过程展示（可折叠）
- **消息重试** — 点击用户消息上的刷新按钮可重新发送，获取不同的 AI 回复
- **复制回复** — 一键复制 AI 回复的原始文本
- **智能滚动** — 仅在用户位于底部时自动滚动，不打断阅读

### 对话历史
- **自动保存** — 聊天记录自动保存（最多 50 条），支持回看和继续对话
- **导出 Markdown** — 将对话记录导出为格式化的 Markdown 文件，含页面标题、导出时间和模型信息
- **新建聊天** — 清空当前对话，自动保存历史记录

### 推荐问题
- **智能推荐** — AI 回复完成后自动生成 3 个相关追问
- **一键发送** — 点击推荐问题即可立即发送

### 大纲生成
- **页面大纲** — 基于页面内容自动生成结构化大纲
- **快速导航** — 点击大纲条目快速定位内容

### OCR 图文识别
- **图片上传** — 支持粘贴或拖拽上传图片进行 OCR 文字识别
- **缩略图预览** — 聊天气泡中显示上传图片的缩略图
- **多图支持** — 支持同时上传多张图片
- **状态指示** — 显示识别中/完成/失败状态

### TTS 语音朗读
- **流式播放** — 支持火山引擎语音合成，流式播放 AI 回复
- **自动朗读** — 可设置 AI 回复完成后自动朗读
- **手动控制** — 点击消息上的播放按钮手动触发朗读
- **一键停止** — 播放中再次点击即可停止

### 播客生成
- **多说话人对话** — 将网页内容转换为多说话人对话形式的音频
- **流式播放** — 通过本地代理服务器连接火山引擎 Podcast TTS API

### 主题与外观
- **夜间模式** — 深色/浅色主题一键切换
- **多主题支持** — 三种配色主题：素笺（暖棕）、海洋（冷蓝）、森林（自然绿）
- **实时同步** — 侧边栏和设置页主题状态实时同步

### 国际化
- **双语支持** — 中文/英文界面切换
- **自动应用** — 语言设置实时生效

### 设置管理
- **模型列表获取** — 点击刷新按钮自动获取可用模型列表
- **自定义 System Prompt** — 追加到默认提示词后，个性化 AI 回答风格
- **设置导入/导出** — 一键备份和恢复全部配置（API 配置、快捷指令、主题等）

### 多模型支持
兼容所有 OpenAI API 格式的服务端点，包括但不限于：
- DeepSeek (`https://api.deepseek.com`)
- OpenAI (`https://api.openai.com/v1`)
- 其他 OpenAI 兼容接口（如 Ollama、vLLM 等）

## 安装使用

### 构建

```bash
npm install
npm run build
```

构建产物输出到 `dist/` 目录，包含：
- `src/side_panel/index.html` 及打包后的 JS/CSS 资源
- `src/options/index.html` 及打包后的 JS/CSS 资源
- `content.js` — 内容脚本 IIFE 包
- `background.js` — Service Worker IIFE 包
- `manifest.json`、`icons/` 等静态资源

### 安装

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `dist/` 目录

### 配置

1. 点击扩展图标打开侧边栏，点击右上角齿轮进入设置
2. 填入 **API Key**（必填）
3. **API 地址**（可选）— 默认为 `https://api.deepseek.com`，可替换为任何 OpenAI 兼容接口
4. **模型名称**（可选）— 默认 `deepseek-chat`，可点击刷新按钮获取可用模型列表
5. **自定义 System Prompt**（可选）— 追加到默认提示词后，个性化 AI 回答风格

### 可选配置

- **TTS 语音合成** — 配置火山引擎 TTS 凭证以启用语音朗读功能
- **OCR 图文识别** — 配置智谱 AI API Key 以启用图片文字识别功能
- **推荐问题** — 开启/关闭 AI 回复后的智能追问推荐
- **播客生成** — 将网页内容转换为多说话人对话形式的音频（需启动本地代理服务器）

### 播客功能使用说明

播客功能通过火山引擎的 Podcast TTS API 实现，由于浏览器 WebSocket 无法设置自定义请求头，需要启动一个本地 Node.js 代理服务器来处理认证。

**启动代理服务器：**

```bash
cd proxy
npm install  # 首次运行需要
npm start
```

代理服务器默认运行在 `http://localhost:3456`。启动后，在扩展中选择网页内容即可生成播客音频。

**配置要求：**
- 需在设置中配置火山引擎 TTS 凭证（`ttsAppId`、`ttsAccessKey`）

### 使用

- 点击工具栏扩展图标打开侧边面板
- 使用顶部快捷按钮（总结 / 翻译 / 关键信息）快速操作
- 在输入框输入问题进行自由问答
- 在页面中选中文字，侧边栏会显示引用预览；快捷操作会自动切换为针对选区内容处理
- 输入 `/` 触发快捷指令菜单
- 点击 AI 消息上的播放按钮朗读回复

## 项目结构

```
chrome-ai-reader/
├── public/
│   ├── manifest.json              # 扩展配置（Manifest V3）
│   └── icons/                     # 扩展图标（16/48/128px）
├── src/
│   ├── background/
│   │   └── service-worker.js      # 后台服务：API 调用、消息中转、OCR 代理
│   ├── content/
│   │   └── index.js               # 内容脚本：页面提取（Readability）、选区监听
│   ├── shared/
│   │   ├── i18n.js                # 国际化：双语翻译、语言切换
│   │   ├── constants.js           # 共享工具：截断限制、HTML 转义
│   │   ├── theme.js               # 主题管理
│   │   └── themes.css             # 主题 CSS 变量定义
│   ├── side_panel/
│   │   ├── index.html             # 侧边栏界面
│   │   ├── main.js                # 入口：初始化编排、全局事件绑定
│   │   ├── state.js               # 集中状态管理：getter/setter、订阅通知
│   │   ├── side_panel.css         # 主样式（CSS 自定义属性主题）
│   │   ├── history.css            # 历史面板样式
│   │   ├── quick-commands.css     # 快捷指令弹窗样式
│   │   ├── message-bubble.css     # 消息气泡样式
│   │   ├── outline.css            # 大纲面板样式
│   │   ├── podcast.css            # 播客面板样式
│   │   ├── ui/
│   │   │   ├── dom-helpers.js     # DOM 辅助：消息渲染、滚动、Markdown
│   │   │   ├── theme.js           # 主题切换：深色模式 + 多主题
│   │   │   └── model-status.js    # 模型状态栏显示
│   │   ├── services/
│   │   │   ├── ai-chat.js         # AI 对话：流式 SSE、推理过程
│   │   │   ├── tts.js             # TTS 流式播放：句子队列、MediaSource
│   │   │   └── ocr.js             # OCR：图片上传、识别、预览
│   │   └── features/
│   │       ├── chat-history.js    # 对话历史：保存/加载/删除/导出
│   │       ├── quick-commands.js  # 快捷指令：过滤、键盘导航
│   │       ├── suggest-questions.js # 推荐追问：流式生成
│   │       ├── outline.js         # 大纲生成
│   │       ├── image-input.js     # 图片粘贴和拖拽
│   │       └── podcast.js         # 播客生成
│   ├── options/
│   │   ├── index.html             # 设置页面
│   │   ├── index.js               # 设置逻辑：配置管理、模型列表、快捷指令
│   │   └── options.css            # 设置页样式（含主题定义）
│   └── libs/
│       └── marked.min.js          # Markdown 渲染
├── proxy/                         # 播客功能的本地代理服务器
│   ├── server.js
│   └── package.json
├── assets/                        # 产品截图等静态资源
├── vite.config.js                 # Vite 构建配置
├── build-extension.js             # Rollup IIFE 打包（content script + service worker）
└── package.json
```

## 技术实现

### 构建系统

项目使用 [Vite](https://vitejs.dev/) 构建，分两个阶段：

1. **Vite build** — 以 `src/side_panel/index.html` 和 `src/options/index.html` 为入口，打包 ES 模块到 `dist/assets/`
2. **Rollup IIFE** (`build-extension.js`) — 将 `src/content/index.js` 和 `src/background/service-worker.js` 打包为自包含 IIFE 脚本（Chrome 内容脚本和 Service Worker 不支持 ES 模块）
3. **静态资源** — `public/` 目录原样复制到 `dist/`

### 模块分层

源文件使用 ES Modules，侧边栏有 5 层依赖层次：

```
Layer 1 — 共享层（无依赖）
  src/shared/i18n.js        — 翻译、t()、loadLanguage()
  src/shared/constants.js   — 截断限制、safeTruncate()、escapeHtml()

Layer 2 — 状态层（依赖共享层）
  src/side_panel/state.js   — getter/setter 状态管理、subscribe/notify

Layer 3 — UI 层（依赖共享层 + 状态层）
  src/side_panel/ui/dom-helpers.js  — DOM 操作、消息渲染
  src/side_panel/ui/theme.js        — 深色模式 + 多主题管理
  src/side_panel/ui/model-status.js — 模型状态栏

Layer 4 — 服务层（依赖共享层 + 状态层 + UI 层）
  src/side_panel/services/ai-chat.js — AI 对话核心、流式 SSE
  src/side_panel/services/tts.js     — TTS 句子队列、MediaSource 流式播放
  src/side_panel/services/ocr.js     — 图片上传、OCR 处理

Layer 5 — 功能层（依赖服务层 + UI 层 + 状态层）
  src/side_panel/features/chat-history.js      — 对话持久化、导出
  src/side_panel/features/quick-commands.js    — 斜杠指令弹窗
  src/side_panel/features/suggest-questions.js — 自动追问推荐
  src/side_panel/features/outline.js           — 大纲生成
  src/side_panel/features/image-input.js       — 图片粘贴和拖拽
  src/side_panel/features/podcast.js           — 播客生成

入口：src/side_panel/main.js — 自底向上编排初始化顺序
```

### 核心通信机制

| 通道 | 方式 | 用途 |
|------|------|------|
| AI 对话 | `chrome.runtime.connect` 长连接端口（`ai-chat`） | 流式传输 AI 回复（thinking/chunk/done/error） |
| TTS 朗读 | `chrome.runtime.connect` 长连接端口（`tts`） | 流式传输语音音频数据 |
| 推荐问题 | `chrome.runtime.connect` 长连接端口（`suggest`） | 流式生成追问建议 |
| 页面提取 | `chrome.tabs.sendMessage` 一次请求 | 获取当前页面正文内容（Readability.js） |
| 选区中转 | `chrome.runtime.sendMessage` 一次请求 | 页面选区文字经 service worker 中转到侧边栏 |
| 模型列表 | `chrome.runtime.sendMessage` 一次请求 | 设置页通过 service worker 代理 API 请求（规避 CORS） |
| OCR 识别 | `chrome.runtime.sendMessage` 一次请求 | 侧边栏通过 service worker 代理 OCR API 请求 |
| 设置同步 | `chrome.storage.onChanged` 监听 | 配置变更后实时生效，无需刷新 |

### 存储说明

**chrome.storage.sync（同步配置）**
| Key | 类型 | 说明 |
|-----|------|------|
| `apiKey` | string | LLM API Key |
| `apiBase` | string | API 地址 |
| `modelName` | string | 模型名称 |
| `systemPrompt` | string | 自定义系统提示词 |
| `darkMode` | boolean | 深色模式 |
| `themeName` | string | 主题名称（sujian/ocean/forest） |
| `language` | string | 界面语言（zh/en） |
| `ttsAppId` | string | TTS 应用 ID |
| `ttsAccessKey` | string | TTS Access Token |
| `ttsResourceId` | string | TTS 资源 ID |
| `ttsSpeaker` | string | TTS 发音人 |
| `ttsAutoPlay` | boolean | 自动朗读 |
| `ocrApiKey` | string | OCR API Key |
| `suggestQuestions` | boolean | 启用推荐问题 |

**chrome.storage.local（本地存储）**
| Key | 类型 | 说明 |
|-----|------|------|
| `quickCommands` | array | 自定义快捷指令 |
| `chatHistories` | array | 对话历史记录（最多 50 条） |

## 开发

```bash
# 安装依赖
npm install

# 开发模式（监听文件变更）
npm run dev

# 生产构建
npm run build
```

开发时运行 `npm run dev`，编辑源文件后 Vite 会自动重新构建。在 `chrome://extensions/` 页面点击刷新按钮加载最新代码。

## 许可证

MIT
