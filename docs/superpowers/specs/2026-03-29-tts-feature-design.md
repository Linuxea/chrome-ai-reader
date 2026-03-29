# TTS 语音合成功能设计

## 概述

在最新一条 AI 回复消息下方添加喇叭按钮，点击后通过火山引擎豆包语音 TTS V3 API（SSE 格式）流式合成并播放语音。

## API 规格

- **端点**: `https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse`
- **协议**: SSE（Server-Sent Events）
- **认证 Headers**: `X-Api-App-Id`（App ID）、`X-Api-Access-Key`（Access Key）、`X-Api-Resource-Id`（资源 ID）
- **音频格式**: mp3, 24000Hz（默认）
- **音色默认值**: `zh_female_vv_uranus_bigtts`
- **Resource ID 默认值**: `seed-tts-2.0`

**SSE 事件类型：**
- `352` (TTSResponse): 包含 base64 音频数据
- `351` (TTSSentenceEnd): 句子处理结束（忽略，不转发）
- `152` (SessionFinish): 会话结束
- `153` (SessionFailed): 会话失败

## 设计分段

### 1. 设置页 TTS 配置

**位置**: `options/options.html`，现有「API 配置」section 内，保存按钮上方

**UI**: `<details>` 折叠面板，标题「TTS 语音合成配置」，展开后四个输入框

**新增存储字段**（`chrome.storage.sync`）：
- `ttsAppId` — 火山引擎 App ID（`type="text"`）
- `ttsAccessKey` — 火山引擎 Access Key（`type="password"`，敏感凭据）
- `ttsResourceId` — 资源 ID，默认 `seed-tts-2.0`（`type="text"`）
- `ttsSpeaker` — 音色，默认 `zh_female_vv_uranus_bigtts`（`type="text"`）

**导出/导入**: TTS 字段需加入现有导出/导入逻辑，与 `apiKey`、`apiBase` 等字段一并列出。导入时若文件中不含 TTS 字段，应 `chrome.storage.sync.remove` 清除旧值。

**文件修改**:
- `options/options.html` — 新增 `<details>` 区域和输入框
- `options/options.js` — 保存/加载逻辑（共用保存按钮）、导出/导入更新
- `options/options.css` — 新增 `<details>/<summary>` 折叠面板样式（使用项目现有 CSS 自定义属性）

### 2. Service Worker TTS 代理

**Port**: `chrome.runtime.onConnect` 监听 port name `'tts'`

**消息格式**:
- side_panel → service_worker: `{ type: 'tts', text: string }`
- service_worker → side_panel: `{ type: 'chunk', data: base64String }`
- service_worker → side_panel: `{ type: 'done' }`
- service_worker → side_panel: `{ type: 'error', error: string }`

**SSE 解析流程**:
1. 从 `chrome.storage.sync` 读取 TTS 配置（`ttsAppId`、`ttsAccessKey`、`ttsResourceId`、`ttsSpeaker`）
2. **配置校验**: 若 `ttsAppId` 或 `ttsAccessKey` 缺失，立即发送 `{ type: 'error', error: '请先在设置页面配置 TTS 语音合成' }` 并关闭 port
3. `fetch` SSE 端点，Headers:
   - `Content-Type: application/json`
   - `X-Api-App-Id: {ttsAppId}`
   - `X-Api-Access-Key: {ttsAccessKey}`
   - `X-Api-Resource-Id: {ttsResourceId}`
4. `response.body.getReader()` 逐块读取，TextDecoder 解码
5. 按 `\n\n` 分割 SSE 事件，解析 `event:` 和 `data:` 行
6. `event=352`: 从 `data` JSON 中提取 `data` 字段（base64 音频），转发 `{ type: 'chunk', data }`
7. `event=153` (SessionFailed): 从 `data` JSON 中提取错误消息，发送 `{ type: 'error', error }`，关闭 reader
8. `event=152` (SessionFinish): 发送 `{ type: 'done' }`
9. `event=351` (TTSSentenceEnd): 忽略
10. 网络错误/fetch 异常: 发送 `{ type: 'error', error: message }`

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

**唯一性**: 新消息到来前，移除上一条消息的喇叭按钮。只有最新一条 AI 消息显示喇叭。

**按钮 DOM**:
```html
<button class="tts-btn" title="朗读">
  <svg><!-- 喇叭 SVG 图标 --></svg>
</button>
```

**CSS**:
- 尺寸 20x20，`var(--text-secondary)` 颜色，`margin-top: 4px`，右对齐
- 三种视觉状态：
  - 默认: 喇叭图标
  - `.tts-loading`: 旋转/呼吸动画（表示正在连接/缓冲，等待首个音频 chunk）
  - `.tts-playing`: 脉冲动画（表示正在播放）

**播放逻辑** (`playTTS(text)`):
1. 若已有播放中 TTS，先调用 `stopTTS()` 停止
2. 设置按钮为 `tts-loading` 状态
3. 建立 `chrome.runtime.connect({ name: 'tts' })` 端口
4. 监听 `port.onDisconnect`: 若被意外断开（如 Service Worker 生命周期终止），重置按钮状态、停止音频
5. 发送 `{ type: 'tts', text }`
6. 收到首个 chunk: 切换为 `tts-playing` 状态，`new AudioContext()`，调用 `audioContext.resume()` 处理浏览器自动播放策略
7. 每个 chunk: base64 → `Uint8Array`（atob + charCodeAt）→ `AudioContext.decodeAudioData` → `AudioBufferSourceNode` 依次播放
8. done 信号: 标记结束，播完最后一个 chunk 后自动恢复按钮
9. error: 停止播放，恢复按钮，可考虑 toast 提示错误信息

**停止逻辑** (`stopTTS()`):
- 断开 port
- 停止当前 `AudioBufferSourceNode`（`.stop()`）
- 清空音频队列
- 恢复按钮为默认状态

**与新 AI 消息的交互**: 用户发送新消息或触发快捷操作时，若 TTS 正在播放，自动调用 `stopTTS()` 停止（在 `callAI` 入口处检查）。

**文本来源**: `fullText`（AI 回复的原始 markdown），配合 `disable_markdown_filter: true` 让 API 过滤 markdown 语法

**文件修改**:
- `side_panel/side_panel.js` — 按钮插入、`playTTS`/`stopTTS` 逻辑、`callAI` 入口增加停止 TTS
- `side_panel/side_panel.css` — 按钮样式、三种状态动画
- `side_panel/ui-helpers.js` — `removeTTSButton` 辅助函数
