# 流式 TTS 设计文档

## 目标

将 TTS 语音合成从"等 AI 完整回复后才开始"改为"AI 流式生成过程中逐批发送 TTS"，降低用户听到语音的等待时间。

## 约束

- 统一方案：自动播放和手动点击都使用相同的流式逻辑
- 逐句发送：每 5 个句末标点切分一次，发给 TTS
- AI 中途出错：已发出的 TTS 请求正常播完，不额外处理
- TTS 出错：直接停止，不重试
- service_worker.js 不改动

## 架构

```
AI chunk 到来
  → 追加到 ttsTextBuffer
  → 句末标点计数 +1
  → 计数达到 5 → 切出文本段 → 清理 Markdown → ttsEnqueue(text)

TTS 调度器 (ttsFlush)
  → 队列非空 且 当前无请求在飞？
    → 取出一段 → 创建 tts port → 发送给 service worker
    → 音频 chunk 返回 → 追加到共享 MediaSource/SourceBuffer
    → TTS done → ttsSending = false → ttsFlush() 自动发下一段

AI done
  → 缓冲区剩余文本入队
  → 全部播完 → MediaSource.endOfStream()

手动点击朗读
  → 如果已在播放 → stopTTS()（toggle 行为）
  → 否则：完整文本一次性按 5 句切分 → 全部入队 → 调度器依次发送
```

## 文件改动

### 新文件：`side_panel/tts-streaming.js`

所有流式 TTS 逻辑，自包含模块。在 `side_panel.js` 之前加载。

**状态变量（全部定义在此文件）：**
- 新增：`ttsSentenceQueue`、`ttsTextBuffer`、`ttsSending`、`ttsSentenceCount`
- 从 side_panel.js 迁移过来：`ttsPort`、`ttsPlaying`、`ttsDone`、`ttsMediaSource`、`ttsSourceBuffer`、`ttsAudioEl`、`ttsChunkQueue`、`ttsBufferAppending`
- 从 side_panel.js 迁移过来：`ttsAutoPlayEnabled`（含 `chrome.storage.sync.get` 初始化和 `chrome.storage.onChanged` 监听）

**对外接口（供 side_panel.js 调用）：**
- `ttsAppendChunk(content)` — AI chunk 回调中调用（仅 `msg.type === 'chunk'`，不含 thinking），追加缓冲区 + 计数 + 入队
- `ttsFlushRemaining()` — AI done 回调中调用，把缓冲区剩余文本入队
- `stopTTS()` — 停止播放，清空队列 + 断开 port + 关闭 MediaSource
- `handleTTSButtonClick(msgEl)` — TTS 按钮点击时调用，处理 toggle（播放中→停止，未播放→开始），提取文本并启动流式播放
- `addTTSButton(msgEl)` — 在 AI 消息上添加 TTS + 复制按钮，按钮点击调用 `handleTTSButtonClick`
- `initTTSAutoPlay(msgEl)` — AI done 且 ttsAutoPlayEnabled 时调用，启动流式自动播放

**内部函数：**
- `initTTSPlayback()` — 创建 MediaSource + Audio 元素，设置 SourceBuffer 和播放事件
- `ttsEnqueue(text)` — 文本段入队并触发调度
- `ttsFlush()` — 调度器，发送队列中下一段
- `ttsAppendNext()` — MSE appendBuffer 队列管理（从 side_panel.js 迁移）
- `stripMarkdown(text)` — 简单正则清理 markdown 语法
- `splitToSegments(text)` — 将完整文本按句末标点切分为段

### 修改：`side_panel/side_panel.js`

- 删除所有迁移到 tts-streaming.js 的代码（状态变量、playTTS、stopTTS、addTTSButton、ttsAppendNext、ttsAutoPlayEnabled 相关）
- `callAI()` chunk 回调中追加 `ttsAppendChunk(msg.content)`（仅 chunk 类型，thinking 类型不调用）
- `callAI()` done 回调中：调用 `addTTSButton(msgEl)` + `initTTSAutoPlay(msgEl)` + `ttsFlushRemaining()`

### 修改：`side_panel/side_panel.html`

添加 `<script src="tts-streaming.js"></script>`，在 `side_panel.js` 之前加载。加载顺序变为：

```
marked.min.js → chat-history.js → quick-commands.js → ui-helpers.js → tts-streaming.js → side_panel.js
```

### 不改动

- `service_worker.js` — callTTS() 保持不变
- `side_panel/ui-helpers.js` — 不变
- `side_panel/chat-history.js` — 不变
- `side_panel/quick-commands.js` — 不变

## 句子切分规则

- 句末标点：`。` `！` `？` `. ` `!` `?`（中英文都支持）
- 每 5 个句末标点切一次
- AI done 时，缓冲区剩余文本（即使不满 5 句）全部入队
- 发送前用 `stripMarkdown()` 清理 markdown 语法

## 音频连续性

- 所有 TTS 段的音频追加到同一个 MediaSource/SourceBuffer，共享同一个 Audio 元素
- 段之间可能有微小间隔（TTS API 请求往返延迟），可接受
- 每段是独立的 TTS API 调用，编码参数一致（mp3, 24000Hz），SourceBuffer 可正常拼接

## 错误处理

- AI 中途出错：不再推新文本到队列，已在队列中的正常播完
- TTS 单句出错：停止播放
- 用户手动停止 / 发新消息：stopTTS() 清空队列 + 断开 port + 关闭 MediaSource

## 数据来源

- 自动播放：TTS 文本来自原始 markdown chunk（`msg.content`），经 `stripMarkdown()` 清理后发送。与现有方案（从 rendered DOM 取 textContent）有细微差异，但效果可接受
- 手动点击：从 DOM `textContent` 提取文本（与现有行为一致），再按句切分
