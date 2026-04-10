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

### OCR 图文识别
- **图片上传** — 支持上传图片进行 OCR 文字识别
- **缩略图预览** — 聊天气泡中显示上传图片的缩略图
- **多图支持** — 支持同时上传多张图片
- **状态指示** — 显示识别中/完成/失败状态

### TTS 语音朗读
- **流式播放** — 支持火山引擎语音合成，流式播放 AI 回复
- **自动朗读** — 可设置 AI 回复完成后自动朗读
- **手动控制** — 点击消息上的播放按钮手动触发朗读
- **一键停止** — 播放中再次点击即可停止

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

### 安装

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择本项目目录

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
- 可选配置 `ttsAppKey`，如未配置则使用默认值

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
├── manifest.json              # 扩展配置（Manifest V3）
├── service_worker.js          # 后台服务：API 调用、消息中转、OCR 代理
├── content.js                 # 内容脚本：页面提取、选区监听
├── i18n.js                    # 国际化：双语翻译、语言切换
├── side_panel/
│   ├── side_panel.html        # 侧边栏界面
│   ├── side_panel.css         # 主样式（CSS 自定义属性主题）
│   ├── side_panel.js          # 交互逻辑：聊天、快捷操作、流式渲染
│   ├── chat-history.js        # 对话历史管理：保存/加载/删除/导出
│   ├── history.css            # 历史面板样式（滑入动画）
│   ├── quick-commands.js      # 快捷指令弹窗逻辑：过滤、键盘导航
│   ├── quick-commands.css     # 快捷指令弹窗样式
│   ├── tts-streaming.js       # TTS 流式播放：句子队列、MediaSource
│   ├── ui-helpers.js          # UI 辅助函数：滚动、截断、消息渲染
│   └── markdown.css           # Markdown 渲染样式
├── options/
│   ├── options.html           # 设置页面
│   ├── options.css            # 设置页样式（含主题定义）
│   └── options.js             # 设置逻辑：配置管理、模型列表、快捷指令 CRUD
├── libs/
│   ├── Readability.js         # Mozilla Readability 页面正文提取
│   └── marked.min.js          # Markdown 渲染
├── assets/                    # 产品截图等静态资源
└── icons/                     # 扩展图标（16/48/128px）
```

## 技术实现

### 架构概览

无构建系统、无框架依赖，所有文件由 Chrome 直接加载。侧边栏脚本按依赖顺序加载：`i18n.js` → `marked.min.js` → `chat-history.js` → `quick-commands.js` → `ui-helpers.js` → `tts-streaming.js` → `side_panel.js`。

```
用户操作 (side_panel.js)
  → chrome.tabs.sendMessage → content.js (Readability 提取页面)
  → chrome.runtime.connect (长连接) → service_worker.js
  → fetch OpenAI 兼容 API (流式 SSE)
  → port.postMessage 回传 → side_panel.js 渲染
```

### 核心通信机制

| 通道 | 方式 | 用途 |
|------|------|------|
| AI 对话 | `chrome.runtime.connect` 长连接端口 | 流式传输 AI 回复（thinking/chunk/done/error） |
| TTS 朗读 | `chrome.runtime.connect` 长连接端口 | 流式传输语音音频数据 |
| 推荐问题 | `chrome.runtime.connect` 长连接端口 | 流式生成追问建议 |
| 页面提取 | `chrome.tabs.sendMessage` 一次请求 | 获取当前页面正文内容 |
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
| `chatHistories` | array | 对话历史记录 |

## 开发

本项目无构建步骤，编辑文件后在 `chrome://extensions/` 页面点击刷新按钮即可生效。

## 许可证

MIT
