# AI 推荐追问功能设计

## 概述

在每条 AI 回复后，自动通过独立 API 调用生成 3 个左右具备建设性的引导问题，帮助用户深入探索网页内容。

## 需求

- 独立 API 调用生成推荐问题，不干扰主回答质量
- 用户点击推荐问题即自动发送，无需手动确认
- 推荐问题显示在 AI 消息气泡外部下方，作为独立可点击区域
- 可在设置中开关，默认开启
- 纳入设置导出/导入

## 架构与数据流

### 触发时机

`callAI` 中收到 `msg.type === 'done'` 后，检查 `suggestQuestions` 开关是否开启，若开启则调用 `generateSuggestions(msgEl, conversationHistory)`。

### 数据流

```
AI 主回答完成 (side_panel.js callAI 'done')
  → 检查 suggestQuestions 开关 (chrome.storage.sync)
  → chrome.runtime.connect({ name: 'suggest-questions' })
  → service_worker.js 新增 port 监听
  → POST {apiBase}/chat/completions (stream: true)
  → port.postMessage({ type: 'chunk', content }) 流式返回
  → side_panel.js 解析 AI 返回的问题列表
  → 在 msgEl 外部下方渲染可点击的问题标签
```

### Prompt 设计

System prompt:
```
你是一个阅读助手。基于对话历史，生成 3 个有深度的后续问题，帮助用户更深入地理解文章内容。每行一个问题，不要编号，不要额外解释。
```

User prompt: 包含最近 2 轮对话（用户问题 + AI 回复摘要），避免发送完整历史以节省 token。AI 回复内容截断到 2000 字符。

### 返回格式

AI 返回纯文本，每行一个问题。side_panel 按换行分割，过滤空行，取前 3 个。

### 存储字段

`chrome.storage.sync` 新增 `suggestQuestions`（boolean，默认 `true`）。

## UI 组件与交互

### 结构

```
[AI 消息气泡 .message-ai]
  └─ 思考区块、回复内容、TTS 按钮（现有）

[推荐问题区域 .suggest-questions]（气泡外部，独立元素）
  ├─ 加载态：骨架屏动画（3 个灰色条）
  └─ 完成态：3 个可点击标签 .suggest-item
       点击 → 自动填入输入框 → 立即触发 sendMessage()
```

### CSS 样式

- `.suggest-questions`：flex wrap，gap 8px，左对齐（与 AI 气泡对齐），上边距 4px
- `.suggest-item`：圆角标签样式，浅色背景 + primary 边框，hover 时 primary 背景 + 白字，cursor pointer，font-size 13px，max-width 90%
- `.suggest-loading`：灰色脉冲动画条，宽度随机（模拟真实文字长度）

### 交互细节

- 点击问题标签后，整个 `.suggest-questions` 区域移除
- 用户发送新消息时，上一轮的推荐问题区域也移除
- API 调用失败时静默隐藏，不打扰用户
- 推荐问题不记入 `conversationHistory`，仅作为 UI 引导
- 加载历史对话时不重新生成推荐问题
- 导出 Markdown 时推荐问题不包含在内

## 设置页变更

### options.html

在"大模型配置"面板中添加开关：

```
推荐追问  [toggle switch]  （标签文字："AI 回复后自动生成推荐问题"）
```

### options.js

- 开关切换后立即保存到 `chrome.storage.sync`
- 不需要点"保存"按钮（与 TTS 配置不同，与快捷指令的实时保存模式一致）

### side_panel.js

监听 `chrome.storage.onChanged`，实时响应开关变化，无需刷新页面。

## 设置导出导入集成

导出 bundle 结构扩展：

```json
{
  "version": 1,
  "apiKey": "...",
  "apiBase": "...",
  "modelName": "...",
  "systemPrompt": "...",
  "ttsAppId": "...",
  "ttsAccessKey": "...",
  "ttsResourceId": "...",
  "ttsSpeaker": "...",
  "suggestQuestions": true,
  "quickCommands": [...]
}
```

- 导出时读取 `suggestQuestions` 值
- 导入时写入 `suggestQuestions` 到 `chrome.storage.sync`
- 兼容旧版导出文件：缺少该字段时默认 `true`，不报错

## 涉及文件

| 文件 | 变更 |
|------|------|
| `side_panel/side_panel.js` | 新增 `generateSuggestions()`，`callAI` done 回调中触发，发送新消息时清除旧推荐区域 |
| `side_panel/side_panel.css` | 新增 `.suggest-questions`、`.suggest-item`、`.suggest-loading` 样式 |
| `service_worker.js` | 新增 `suggest-questions` port 监听，调用 `callSuggestQuestions()` |
| `options/options.html` | 大模型配置面板中添加开关 |
| `options/options.js` | 开关状态读取/保存/导入导出逻辑 |
