# 选中文本引用功能设计

## 概述

当用户在网页上选中文字时，AI 阅读助手的侧边栏输入框上方实时显示引用预览。用户发送自由问答时，完整引用内容作为 prompt 的一部分发给 AI，聊天气泡中展示截断预览。

## 需求

1. **选中即展示**：用户在网页选中文字 → 输入框上方实时显示引用预览
2. **取消即消失**：取消选中 → 引用区域消失
3. **发送时携带**：自由问答时，完整引用内容作为 prompt 的一部分发给 AI
4. **聊天气泡预览**：用户消息气泡里展示截断引用（前 50 字 + `...`），AI 收到完整内容
5. **快捷操作不参与**：总结/翻译/关键信息仍只用完整页面内容
6. **手动清除**：引用预览条右侧有 ✕ 按钮可手动清除

## 技术方案

### 通信：content.js 推送 + 防抖

```
页面 selectionchange 事件（300ms 防抖）
  → content.js 获取 window.getSelection().toString().trim()
  → chrome.runtime.sendMessage({ action: 'selectionChanged', text })
  → side_panel.js 通过 chrome.runtime.onMessage 接收
  → 更新 selectedText 变量和引用区域 UI
```

- 空文本（取消选中）时也发送 `text: ''`，触发隐藏引用区域
- 300ms 防抖避免拖选过程中高频触发

### UI：输入框上方引用预览条

```
┌──────────────────────────────────┐
│ 📄 "选中的文字前50字..."        ✕ │  ← 引用预览条
├──────────────────────────────────┤
│ ┌────────────────────────┬──┐    │
│ │ 输入问题...             │▶│    │  ← 原有输入框
│ └────────────────────────┴──┘    │
└──────────────────────────────────┘
```

- 浅色背景 + 左侧竖线（blockquote 风格）
- 截断显示前 50 字 + `...`
- ✕ 按钮清除 selectedText 并隐藏区域
- 无选中时 `display: none`

### Prompt 集成：虚拟 user/assistant 对

在 `sendMessage()` 构建 messages 时，如果有 `selectedText`，在 system prompt 和历史对话之间插入：

```js
if (selectedText) {
  messages.push({
    role: 'user',
    content: `以下是用户从页面中引用的内容：\n\n${selectedText}`
  });
  messages.push({
    role: 'assistant',
    content: '好的，我已收到引用内容。请问您有什么问题？'
  });
}
```

完整 messages 结构：

```
1. { system, "页面全文上下文..." }
2. { user,   "以下是引用内容：..." }       ← 新增
3. { assistant, "好的，我已收到引用内容" }  ← 新增
4. ... 历史对话 ...
5. { user,   "用户实际提的问题" }
```

### 聊天气泡：引用预览

用户发送带引用的消息时，气泡结构：

```html
<div class="message message-user">
  <blockquote class="quote-preview">选中的文字前50字...</blockquote>
  <span>用户实际提的问题</span>
</div>
```

- 使用 `<blockquote>` 复用已有 CSS（左侧 3px 紫色竖线 + 灰色文字）
- `appendMessage('user', ...)` 从 `textContent` 改为 `innerHTML`，用户输入部分做 HTML 转义

## 改动文件

| 文件 | 改动内容 |
|------|---------|
| `content.js` | 添加 `selectionchange` 监听 + 防抖，发送 `selectionChanged` 消息 |
| `side_panel.html` | 在 `.input-area` 内、`.input-wrapper` 前添加引用预览条 HTML |
| `side_panel.css` | 添加引用预览条样式 |
| `side_panel.js` | 接收选中消息、管理 selectedText 状态、prompt 集成、气泡渲染 |

不改动：`manifest.json`、`service_worker.js`、`options/`。

## 边界情况

- 选中文本为纯空白：视为无选中，不显示引用区域
- 引用内容超过 prompt token 限制：截断到 2000 字（与页面内容截断逻辑一致）
- 新建聊天：清除 `selectedText` 和引用区域
- 快捷操作：忽略 selectedText，不参与 prompt
