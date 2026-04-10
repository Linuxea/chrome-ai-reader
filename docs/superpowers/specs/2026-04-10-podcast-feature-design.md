# 播客功能设计文档

**日期**: 2026-04-10
**状态**: Draft

## 概述

在侧边面板的快捷指令区域新增「播客」按钮。点击后，扩展通过用户配置的 LLM 生成两人对话脚本，再调用火山引擎播客 API 将脚本合成为两人对话的播客音频，流式播放给用户。该功能与现有聊天流程完全独立，使用自己的提示词、API 调用链和播放器。

## 核心原则

- **独立于聊天流程** — 播客不使用现有的聊天消息/对话历史，有独立的提示词和 API 调用链
- **与快捷指令一致** — 播客按钮的行为与「总结」「翻译」等快捷指令类似：提取页面内容/引用文字 → 发给 LLM
- **复用现有凭证** — 播客 API 使用与 TTS 相同的火山引擎凭证（App ID、Access Key），无需新增配置项
- **抑制 TTS 自动播放** — 播客生成时自动禁用 TTS，避免两个音频源冲突

## 用户流程

```
1. 用户点击快捷指令区域的「播客」按钮
2. 扩展提取文本来源（优先级）：
   ├── 有选中文字？ → 使用引用文字
   ├── 有 OCR 结果？ → 包含 OCR 文字
   └── 否则 → 提取当前页面完整内容
3. 组合：文本来源 + 硬编码的播客提示词 → 发送给 LLM
4. LLM 流式生成对话脚本（用户不直接看到文本，卡片显示「生成脚本中...」）
5. LLM 完成 → 解析对话脚本为 nlp_texts
6. 发送给火山引擎播客 API（action=3）→ 流式音频返回
7. 播客卡片内播放音频
```

## UI 设计

### 播客按钮

- 位置：快捷指令区域（与「总结」「翻译」「提取关键信息」并列）
- 图标：播客/电台图标（🎙️ 或自定义 SVG）
- 点击后不可重复点击（生成中禁用）

### 播客卡片

插入在聊天区域中的一张独立卡片：

```
┌──────────────────────────────────┐
│ 🎙️ 播客                        │
├──────────────────────────────────┤
│  ◉ 正在生成对话脚本...          │  ← 状态: generating_script
│  ◉ 正在合成播客音频...          │  ← 状态: generating_audio
│  ▶ ━━━━━━●━━━━━━━━ 02:35/05:12 │  ← 状态: playing
│  ✓ 播放完成  [重新播放]         │  ← 状态: done
│  ✗ 生成失败  [重试]             │  ← 状态: error
└──────────────────────────────────┘
```

**状态机**：

| 状态 | 显示内容 | 用户操作 |
|------|----------|----------|
| `generating_script` | 加载动画 + "正在生成对话脚本..." | 无（等待） |
| `generating_audio` | 加载动画 + "正在合成播客音频..." | 无（等待） |
| `playing` | 播放进度条 + 暂停按钮 + 时长 | 暂停/播放 |
| `paused` | 播放进度条 + 播放按钮 + 时长 | 继续/停止 |
| `done` | "播放完成" + 重新播放按钮 | 重新播放 |
| `error` | 错误提示 + 重试按钮 | 重试 |

## 数据流与通信架构

### 架构方案：双 Port 串联

复用现有的 Chrome runtime port 模式，建立两个独立的 port 连接。

### 阶段 1：LLM 脚本生成（`podcast-llm` port）

```
side_panel                              service_worker
    │                                        │
    │── connect({ name: 'podcast-llm' }) ──→ │
    │── { type: 'generate',                  │
    │     text: pageContent,                 │──→ fetch LLM API (SSE)
    │     prompt: PODCAST_PROMPT }           │     (复用现有 SSE 流式逻辑)
    │                                        │
    │←─ { type: 'chunk', content }           │←── SSE chunk（累积但不展示）
    │←─ { type: 'chunk', content }           │
    │←─ { type: 'done',                     │
    │     fullScript: '...' }                │←── LLM 完成，返回完整脚本
    │                                        │
```

side panel 收到 `done` 后：
1. 解析 `fullScript` 为 `nlp_texts`
2. 更新卡片状态为 `generating_audio`
3. 建立第二个 port 连接

### 阶段 2：播客音频生成（`podcast-audio` port）

```
side_panel                              service_worker
    │                                        │
    │── connect({ name: 'podcast-audio' }) ─→│
    │── { type: 'generate',                  │──→ WebSocket to
    │     nlpTexts: [...],                   │     openspeech.bytedance.com
    │     audioConfig: { format, sampleRate }}│
    │                                        │
    │←─ { type: 'audio_chunk',              │←── 361 event (base64 audio)
    │     data: base64Audio }                │
    │←─ { type: 'round_start',              │←── 360 event
    │     idx, speaker }                     │
    │←─ { type: 'round_end',                │←── 362 event
    │     audioDuration, startTime, endTime } │
    │←─ { type: 'done' }                    │←── 152 event
    │                                        │
```

## LLM 提示词设计

播客提示词硬编码在代码中（与快捷指令提示词一致），要求 LLM 输出结构化 JSON：

```
你是一位专业的播客节目制作人。请根据以下内容，生成一段两人对话的播客脚本。

要求：
1. 两位主播分别为"主播A"和"主播B"
2. 对话风格自然、生动，像真实的播客节目
3. 总共生成 8-15 轮对话
4. 每轮对话不超过 300 字
5. 请严格按以下 JSON 格式输出，不要输出其他内容：

{"rounds":[{"speaker":"A","text":"对话内容"},{"speaker":"B","text":"对话内容"}]}

待处理的内容：
{content}
```

**speaker 映射**（硬编码）：

| 脚本中 | 播客 API speaker_id |
|---------|---------------------|
| A | `zh_male_xxx`（待确认具体 ID） |
| B | `zh_female_vv_uranus_bigtts`（复用 TTS 默认 speaker） |

## 对话脚本解析

```javascript
function parsePodcastScript(fullScript) {
  // 1. 尝试提取 JSON（可能被 markdown code block 包裹）
  const jsonMatch = fullScript.match(/\{[\s\S]*"rounds"[\s\S]*\}/);
  if (!jsonMatch) throw new Error('无法解析播客脚本');

  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed.rounds?.length) throw new Error('对话轮次为空');

  // 2. 映射 speaker 标识
  return parsed.rounds.map(round => ({
    speaker: SPEAKER_MAP[round.speaker] || DEFAULT_SPEAKER,
    text: round.text
  }));
}
```

## 火山引擎播客 API 集成

### WebSocket 协议

播客 API 使用 WebSocket v3 二进制协议，与现有 TTS 的 SSE 方式不同。

**连接地址**：`wss://openspeech.bytedance.com/api/v3/tts/podcast/ws`（待确认具体路径）

**认证**：HTTP headers during WebSocket handshake（复用 TTS 凭证）：
- `X-Api-App-Id`: 来自 `chrome.storage.sync.ttsAppId`
- `X-Api-Access-Key`: 来自 `chrome.storage.sync.ttsAccessKey`
- `X-Api-Resource-Id`: 播客专用 resource ID（待确认）

### 二进制帧格式

```
Byte 0-3:  Header
  [0]: Protocol version (0x11 = v1)
  [1]: Client type (0x94 = Full-client request)
  [2]: Content type (0x10 = JSON, no compression)
  [3]: 0x00

Byte 4-7:  Event type (uint32 big-endian)
Byte 8-11: Session ID length (uint32 big-endian)
Byte 12-N: Session ID (UTF-8 string)
Byte N+1-N+4: Payload length (uint32 big-endian)
Byte N+5-...: Payload (JSON)
```

### 事件流程

```
Client → Server:  StartSession (event 150)
                  payload: { action: 3, nlp_texts: [...], audio_config: {...}, speaker_info: {...} }

Server → Client:  SessionStarted (event 150) — 确认会话开始

Server → Client:  PodcastRoundStart (event 360) — 新轮次开始
                  payload: { idx: 0, speaker: "zh_male_xxx" }

Server → Client:  PodcastRoundResponse (event 361) — 音频数据
                  payload: base64 encoded audio bytes

Server → Client:  PodcastRoundEnd (event 362) — 轮次结束
                  payload: { audio_duration, start_time, end_time }

Server → Client:  PodcastEnd (event 363) — 播客结束（可选，可能不返回）

Server → Client:  SessionFinished (event 152) — 会话完成

Client → Server:  FinishSession (event 152)
Client → Server:  FinishConnection (event 2)
Server → Client:  ConnectionFinished (event 52)
```

### 音频配置

```javascript
const defaultAudioConfig = {
  format: 'mp3',         // 与现有 TTS MediaSource 兼容
  sample_rate: 24000,    // 默认采样率
  speech_rate: 0         // 正常语速
};

const defaultSpeakerInfo = {
  random_order: true     // 随机顺序
};
```

## 音频播放

复用现有 TTS 的 MediaSource + SourceBuffer 方案：

1. 收到第一个 `audio_chunk` → 创建 MediaSource + Audio 元素
2. 每收到 `audio_chunk` → 将 base64 解码后 append 到 SourceBuffer
3. SourceBuffer 更新结束后 → 自动播放
4. 收到 `done` → 标记播放完成

## TTS 自动播放抑制

在 `callAI` 的 `done` 处理中增加标志位：

```javascript
// ai-chat.js callAI() done handler
if (msg.type === 'done') {
  // ...
  if (!isPodcast) {
    addTTSButton(msgEl);
    initTTSAutoPlay(msgEl);
  }
}
```

播客流程中 `callAI` 调用时传入 `isPodcast: true`，跳过 TTS 按钮添加和自动播放。

## 文件改动

| 文件 | 改动类型 | 描述 |
|------|----------|------|
| `src/side_panel/features/podcast.js` | **新增** | 播客主逻辑：按钮事件、卡片 UI 创建/更新、状态管理、LLM 输出解析、音频播放（MediaSource） |
| `src/background/service-worker.js` | 修改 | 新增 `podcast-llm` 和 `podcast-audio` 两个 port 处理。`podcast-llm` 复用现有 SSE 流式调用逻辑；`podcast-audio` 新增 WebSocket 连接到火山引擎播客 API |
| `src/side_panel/main.js` | 修改 | 导入并初始化 podcast 模块 `initPodcast()`，在快捷指令区域渲染播客按钮 |
| `src/side_panel/services/ai-chat.js` | 修改 | `callAI` 增加 `isPodcast` 参数，为 true 时跳过 TTS 按钮和自动播放 |
| `src/side_panel/state.js` | 修改 | 新增 `isPodcastGenerating` 状态（防止重复点击） |
| `src/shared/i18n.js` | 修改 | 新增播客相关翻译字符串 |
| `src/side_panel/side_panel.html` | 修改 | 快捷指令区域新增播客按钮容器 |
| `src/side_panel/side_panel.css` | 修改 | 播客卡片样式、加载动画、播放器控件样式 |

## 国际化字符串

```javascript
// zh
'podcast.button': '播客',
'podcast.generatingScript': '正在生成对话脚本...',
'podcast.generatingAudio': '正在合成播客音频...',
'podcast.play': '播放',
'podcast.pause': '暂停',
'podcast.done': '播放完成',
'podcast.replay': '重新播放',
'podcast.error': '生成失败',
'podcast.retry': '重试',
'podcast.noContent': '没有可用的页面内容',

// en
'podcast.button': 'Podcast',
'podcast.generatingScript': 'Generating script...',
'podcast.generatingAudio': 'Synthesizing audio...',
'podcast.play': 'Play',
'podcast.pause': 'Pause',
'podcast.done': 'Playback complete',
'podcast.replay': 'Replay',
'podcast.error': 'Generation failed',
'podcast.retry': 'Retry',
'podcast.noContent': 'No page content available',
```

## 错误处理

| 场景 | 处理 |
|------|------|
| 页面内容为空 | 卡片显示 "没有可用的页面内容"，不发起请求 |
| LLM 请求失败 | 卡片显示错误状态 + 重试按钮 |
| LLM 输出无法解析为对话脚本 | 卡片显示错误，提示脚本格式异常 |
| 播客 API WebSocket 连接失败 | 卡片显示错误状态 + 重试按钮 |
| 播客 API 返回失败事件（153） | 卡片显示错误信息 |
| 音频播放中断 | 显示当前播放位置，用户可重播 |
| TTS 凭证未配置 | 播客按钮禁用或点击后提示配置 |

## 约束与限制

- 播客 API `action=3` 的 `nlp_texts` 每轮不超过 300 字符，总文本不超过 10000 字符
- 播客脚本需要 LLM 一次性生成完毕后才能开始音频合成（两阶段流程）
- Service worker 中的 WebSocket 连接受 Chrome 扩展生命周期限制（可能需要处理重连）
- 播客按钮生成中时禁用，防止重复请求
