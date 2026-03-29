# TTS 语音合成功能设计

## 概述

在最新一条 AI 回复消息下方添加喇叭按钮，点击后通过火山引擎豆包语音 TTS V3 API（SSE 格式）流式合成并播放语音。

## API 规格

- **端点**: `https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse`
- **协议**: SSE（Server-Sent Events）
- **认证**: `X-Api-App-Id` + `X-Api-Access-Key` + `X-Api-Resource-Id`
- **音频格式**: mp3, 24000Hz（默认）
- **音色默认值**: `zh_female_vv_uranus_bigtts`
- **Resource ID 默认值**: `seed-tts-2.0`

**SSE 事件类型：**
- `352` (TTSResponse): 包含 base64 音频数据
- `351` (TTSSentenceEnd): 句子处理结束
- `152` (SessionFinish): 会话结束
- `153` (SessionFailed): 会话失败

## 设计分段

### 1. 设置页 TTS 配置

**位置**: `options/options.html`，现有「API 配置」section 内，保存按钮上方

**UI**: `<details>` 折叠面板，标题「TTS 语音合成配置」，展开后四个输入框

**新增存储字段**（`chrome.storage.sync`）：
- `ttsAppId` — 火山引擎 App ID
- `ttsAccessKey` — 火山引擎 Access Key
- `ttsResourceId` — 资源 ID，默认 `seed-tts-2.0`
- `ttsSpeaker` — 音色，默认 `zh_female_vv_uranus_bigtts`

**文件修改**:
- `options/options.html` — 新增 `<details>` 区域和输入框
- `options/options.js` — 保存/加载逻辑，与现有 API 配置共用保存按钮
- `options/options.css` — 折叠面板样式

### 2. Service Worker TTS 代理

**Port**: `chrome.runtime.onConnect` 监听 port name `'tts'`

**消息格式**:
- side_panel → service_worker: `{ type: 'tts', text: string }`
- service_worker → side_panel: `{ type: 'chunk', data: base64String }`
- service_worker → side_panel: `{ type: 'done' }`
- service_worker → side_panel: `{ type: 'error', error: string }`

**SSE 解析流程**:
1. 从 `chrome.storage.sync` 读取 TTS 配置
2. `fetch` SSE 端点，headers 包含认证信息
3. `response.body.getReader()` 逐块读取
4. 按 `\n\n` 分割 SSE 事件，解析 `event:` 和 `data:` 行
5. `event=352` 时提取 `data` 字段中的 base64 音频并转发
6. `event=152` 时发送 done 信号

**请求 Body**:
```json
{
  "user": { "uid": "chrome-ext" },
  "req_params": {
    "text": "要合成的文本",
    "speaker": "zh_female_vv_uranus_bigtts",
    "audio_params": {
      "format": "mp3",
      "sample_rate": 24000
    },
    "additions": {
      "disable_markdown_filter": true
    }
  }
}
```

**文件修改**:
- `service_worker.js` — 新增 port 监听和 `callTTS` 函数

### 3. Side Panel 喇叭按钮与音频播放

**按钮插入时机**: AI 流式回复完成时（`msg.type === 'done'`），向 `msgEl` 末尾追加

**唯一性**: 新消息到来前，移除上一条消息的喇叭按钮

**按钮 DOM**:
```html
<button class="tts-btn" title="朗读">
  <svg><!-- 喇叭 SVG 图标 --></svg>
</button>
```

**CSS**:
- 尺寸 20x20，`var(--text-secondary)` 颜色，`margin-top: 4px`，右对齐
- `.tts-playing` class 触发 CSS keyframe 脉冲动画

**播放逻辑** (`playTTS(text)`):
1. 建立 `chrome.runtime.connect({ name: 'tts' })` 端口
2. 发送 `{ type: 'tts', text }`
3. 收到 chunk: base64 → ArrayBuffer → `AudioContext.decodeAudioData` 入队
4. `AudioBufferSourceNode` 依次播放队列
5. done 信号标记结束，播完最后 chunk 后自动恢复按钮

**停止逻辑**:
- 播放中点击 → 断开 port → 停止当前 AudioBufferSourceNode → 恢复按钮
- 播放完成 → 自动恢复按钮

**文本来源**: `fullText`（AI 回复的原始 markdown），配合 `disable_markdown_filter: true` 让 API 过滤 markdown

**文件修改**:
- `side_panel/side_panel.js` — 按钮插入、播放/停止逻辑
- `side_panel/side_panel.css` — 按钮样式和动画
- `side_panel/ui-helpers.js` — 可能需要 `removeTTSButton` 辅助函数
