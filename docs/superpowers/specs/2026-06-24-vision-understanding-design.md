# 视觉理解（Vision）设计文档

**日期**: 2026-06-24
**状态**: 设计已对齐，待实现

---

## 1. 背景与目标

### 1.1 要解决的问题

现有"小🍐子阅读助手"的图片能力是 **OCR 文字识别**：`ocr.ts` 调 `ocrParse` 把图片转成纯文本，再以文字形式拼进 user 消息发给模型。`imageUris` 参数只用于聊天气泡里显示缩略图，**从未发给模型**。`ChatMessage.content` 是 `string`，协议层不支持多模态内容块。

这意味着模型对图片是"盲"的：图表走势、公式结构、排版层次、canvas/反爬页面的视觉信息——这些 DOM 文字和 OCR 都表达不了的东西，模型完全拿不到。

### 1.2 目标

把现有纯文字聊天升级为**可选的多模态聊天**：

- 用户在设置页勾选"模型支持视觉"后，出现"视觉分析"按钮
- 点"视觉分析"按钮 → 对当前 tab 可视区截图（`chrome.tabs.captureVisibleTab`）→ 截图进预览条 → 可加文字 → 一起发送
- 上传/粘贴/拖拽的图片在视觉开启时也改走视觉（以 `image_url` 发给模型），不再触发 OCR
- 视觉对话是**连续多轮**的：截图→分析→文字追问→滚动再截图→继续追问，同一 `conversationHistory`
- 未勾选视觉时一切照旧，OCR 路径完全不变

### 1.3 非目标

- **不做**全页长截图 / `debugger` 权限 / `Page.captureScreenshot`（用户手动滚动+多次截图替代）
- **不做**侧边栏自身截图（`captureVisibleTab` 只截浏览器内容区，不含侧边栏）
- **不做**图片持久化到 `chrome.storage`（视觉对话中的图片仅内存态，重启后丢失，文字保留）
- **不做**厂商格式适配（统一用 OpenAI `image_url` 格式，不支持 Claude 原生 API 的 `image`+`source` 格式）
- **不做**模型能力探测（勾选是用户承诺，模型不支持时由 API 报错兜底）
- **不做**硬性张数限制（靠用户自觉 + API 请求体大小软提示兜底）

---

## 2. 核心决策摘要

| 项 | 决定 |
|---|---|
| 功能形态 | 现有聊天升级为可选多模态，视觉与普通聊天共用同一历史流（一体化，不隔离） |
| 触发 | 设置页勾选"模型支持视觉" → 出现"视觉分析"按钮（相机图标，紧挨上传按钮） |
| 截图方式 | `chrome.tabs.captureVisibleTab`，只截当前 tab 可视区，side panel 直接调用（无需新权限） |
| 截图交互 | 点按钮 → 截图进预览条 → 可加文字 → 手动发送（非一步到位） |
| 图片格式 | 统一 OpenAI `image_url` 格式：`{type:'image_url', image_url:{url:'data:image/png;base64,...'}}` |
| 模型配置 | 复用主聊天 `apiBase/apiKey/modelName`，不新增视觉专用配置项 |
| OCR 关系 | 视觉开启 → 所有图片（截图+上传+粘贴+拖拽）走视觉，跳过 OCR；视觉关闭 → 走现有 OCR（兜底保留，不废弃） |
| 历史持久化 | 图片不写 `chrome.storage`，存盘前剥离 `image_url` 块只留文字；重启后图片失效，聊天气泡显示"图片已失效"提示 |
| 图片张数 | 不硬限；发送前算 base64 总字节，超 10MB 给警告提示（不阻断） |
| ChatMessage.content | 从 `string` 升级为 `string \| MessageContentPart[]` |
| 持久化标记 | `ChatMessage` 加可选 `hadImages?: boolean`（仅内存态），用于重载后渲染"图片已失效" |

---

## 3. 模块职责与数据流

### 3.1 改动范围概览

```
src/shared/types.ts          ← ChatMessage.content 联合类型 + MessageContentPart
src/shared/types.js          ← JSDoc typedef 同步
src/shared/protocol.ts       ← AIChatRequest.messages 类型自动变宽（无结构改动）
src/side_panel/services/screenshot.ts   ← 新增：captureVisibleTab 封装
src/side_panel/services/ocr.ts          ← ingestImages 视觉开启时跳过 runOCR
src/side_panel/services/message-sender.ts ← sendToAI 视觉开启时组装数组 content
src/side_panel/services/chat/history-ops.ts ← appendHistory 持久化前剥离图片
src/side_panel/ui/dom-helpers.ts        ← appendMessage 渲染数组 content 的图片块
src/options/ (设置页)                   ← 新增"模型支持视觉"复选框
src/side_panel/index.html               ← 新增"视觉分析"按钮
public/manifest.json                    ← 不动（activeTab 已够）
```

### 3.2 数据流：视觉开启时发送一条带图消息

```
[用户点"视觉分析"按钮]
     ↓
screenshot.ts: captureVisibleTab() → PNG dataUrl
     ↓
ocr.ts: addImagePreview(idx, "截图 {timestamp}", dataUrl)   ← 复用预览条，不调 runOCR
     ↓
[用户可选敲文字，点发送]
     ↓
message-sender.ts: sendMessage()
     ├─ collectImageDataUris()  ← 从预览条收集所有 data URI
     ├─ buildOcrContext()       ← 视觉开启时 ocrResults 为空，返回 ''
     ├─ clearImagePreviews()
     └─ sendToAI(text, text, undefined, '', imageUris)
            ↓
            visionOn === true && imageUris.length > 0
            ↓
            组装 content 为 MessageContentPart[]:
              [{type:'text', text: apiContent},
               {type:'image_url', image_url:{url: uri1}},
               {type:'image_url', image_url:{url: uri2}}, ...]
            ↓
            appendHistory(tabState, msg, tabId)
            ├─ stripImagesForPersistence(msg)  ← 剥离 image_url 块，只留文字
            └─ 写 chrome.storage.local（文字 only）
            ↓
            callAI(messages, tabId)  ← 内存里 messages 仍带 image_url 块
            ↓
            sw-openai.ts: 透传 fetch body（content 数组原生支持）
            ↓
            [视觉模型流式回复]
```

### 3.3 数据流：视觉关闭时（现状不变）

```
[用户上传/粘贴/拖拽图片]
     ↓
ocr.ts: ingestImages(files)
     ├─ visionOn === false
     ├─ addImagePreview(...)
     └─ runOCR(idx, name, dataUri)  ← 现有 OCR 流程
     ↓
[用户点发送]
     ↓
message-sender.ts: sendToAI(text, text, undefined, ocrContext, imageUris)
     ├─ visionOn === false  →  走现有字符串 content 路径
     ├─ apiContent += '\n\n' + ocrContext
     └─ messages.push({role:'user', content: apiContent})  ← 字符串，现状
```

---

## 4. 详细设计

### 4.1 配置变更

`chrome.storage.sync` 新增布尔字段 `visionEnabled`（默认 `false`）。

设置页"模型设置"区加复选框：
```html
<label>
  <input type="checkbox" id="visionEnabled" />
  <span data-i18n="settings.vision.enabled">模型支持视觉能力</span>
</label>
<p class="setting-hint" data-i18n="settings.vision.hint">
  勾选后需使用 OpenAI 兼容的视觉模型（如 gpt-4o、qwen-vl）
</p>
```

`platform/storage.ts` 通过现有 `getSync('visionEnabled')` 访问，无需新 API。`onSyncChange` 监听 `visionEnabled` 变化 → 显示/隐藏"视觉分析"按钮（无需 reload）。

### 4.2 ChatMessage 类型升级

`src/shared/types.ts`：

```typescript
export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | MessageContentPart[];
  type?: string;
  /** 仅内存态标记：该消息原本含图片，重启后图片已失效。持久化时不写此字段。 */
  hadImages?: boolean;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}
```

`src/shared/types.js` 的 JSDoc typedef 同步更新 `content` 类型注释。

**影响面扫描**：所有读 `msg.content` 的地方需判断 `typeof content === 'string'`。主要点位：
- `message-sender.ts` 组装消息（本设计改点）
- `dom-helpers.ts` 渲染气泡（本设计改点）
- `history-ops.ts` 持久化（本设计改点）
- `sw-openai.ts` 透传 fetch body（数组 content 原生支持，但若有 `.slice()`/长度判断需加守卫）

### 4.3 协议层

`src/shared/protocol.ts` 的 `AIChatRequest.messages: ChatMessage[]` 类型随 ChatMessage 升级自动支持数组 content，**无结构改动**。`StreamMessage`（assistant 回复）仍是文字流，不变。

### 4.4 截图服务（新增）

`src/side_panel/services/screenshot.ts`：

```typescript
import { getActiveTab } from '../../platform/tabs';

export async function captureVisibleTab(): Promise<string> {
  const tab = await getActiveTab();
  if (!tab.windowId) throw new Error('No active tab window');
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  return dataUrl;
}
```

`captureVisibleTab` 在 side panel 页面可直接调（`activeTab` 权限已够，manifest 不动）。返回 PNG data URI。**不经 background**——side panel 有 `chrome.tabs` 访问权。

错误处理：无活跃 tab / `chrome://` 内部页 / 权限丢失 → promise reject，调用方在预览条显示错误态（复用 `.image-status.error`）。

### 4.5 图片 intake 分叉

`src/side_panel/services/ocr.ts` 的 `ingestImages` 改为 async，读 `visionEnabled`：

```typescript
export async function ingestImages(files: File[]): Promise<void> {
  if (files.length === 0) return;
  _imagePreviewBar.classList.remove('hidden');
  const visionOn = (await getSync('visionEnabled'))?.visionEnabled === true;
  for (const file of files) {
    let idx = state.getImageIndex(); idx++; state.setImageIndex(idx);
    const dataUri = await readAsDataURL(file);  // 原 FileReader 包成 Promise
    addImagePreview(idx, file.name, dataUri);
    if (!visionOn) runOCR(idx, file.name, dataUri);  // 视觉开启时跳过
  }
}
```

截图按钮也通过 `ingestImages` 的同构路径注入预览条——把 data URI 包装成一个伪 File 或新增一个 `addImageToPreview(dataUri, name)` 辅助函数，避免 `ingestImages` 只吃 File。推荐后者：

```typescript
export async function addImageDataUri(dataUri: string, name: string): Promise<void> {
  _imagePreviewBar.classList.remove('hidden');
  let idx = state.getImageIndex(); idx++; state.setImageIndex(idx);
  addImagePreview(idx, name, dataUri);
  // 视觉开启时截图本就不该走 OCR；视觉关闭时截图按钮本身不显示，不会进这里
}
```

### 4.6 "视觉分析"按钮

`src/side_panel/index.html`，紧挨 `imageUploadBtn`：

```html
<button id="visionCaptureBtn" class="action-btn hidden" title="视觉分析" data-i18n-title="sidebar.visionCapture">
  <svg>...相机图标...</svg>
</button>
```

`visionEnabled=false` 时 `hidden`。初始化时读 `visionEnabled` + `onSyncChange('visionEnabled', ...)` 实时切换显隐。

点击行为：
```typescript
_visionCaptureBtn.addEventListener('click', async () => {
  try {
    const dataUri = await captureVisibleTab();
    const name = `截图 ${formatTimestamp(new Date())}`;
    await addImageDataUri(dataUri, name);
  } catch (e) {
    appendMessage('error', t('error.screenshotFailed') + (e.message ? `：${e.message}` : ''));
  }
});
```

### 4.7 发送时分叉

`src/side_panel/services/message-sender.ts` 的 `sendToAI` 是关键改点。新增 `visionOn` 判断，组装数组或字符串 content：

```typescript
export async function sendToAI(
  text: string,
  displayText: string,
  retryQuote?: string,
  ocrContext?: string,
  imageUris?: string[],
): Promise<void> {
  // ... 前置不变（emit、tabState、quoteForContext、appendMessage 渲染） ...

  const visionOn = (await getSync('visionEnabled'))?.visionEnabled === true;
  const hasImages = visionOn && imageUris && imageUris.length > 0;

  // ... 组装 system 消息、conversationHistory 不变 ...

  let historyContent = text;
  let apiContent = text;
  if (quoteForContext) { /* 现有 quote 拼接不变 */ }

  let userMessage: ChatMessage;
  if (hasImages) {
    const parts: MessageContentPart[] = [];
    if (apiContent) parts.push({ type: 'text', text: apiContent });
    for (const uri of imageUris!) parts.push({ type: 'image_url', image_url: { url: uri } });
    userMessage = { role: 'user', content: parts, hadImages: true };
    // historyContent 仍用纯文字（持久化用）
    historyContent = apiContent;
  } else {
    if (ocrContext) apiContent += '\n\n' + ocrContext;
    userMessage = { role: 'user', content: apiContent };
    historyContent = apiContent;
  }
  messages.push(userMessage);
  appendHistory(tabState, userMessage, startTabId!);  // appendHistory 内部剥离图片再存盘

  // 请求体大小软提示
  if (hasImages) {
    const totalBytes = imageUris!.reduce((sum, u) => sum + u.length, 0);
    if (totalBytes > 10 * 1024 * 1024) {
      appendMessage('error', t('error.visionPayloadTooLarge'));
      // 不阻断，继续发送
    }
  }

  await callAI(messages, startTabId);
}
```

**注意**：`sendMessage()` 里读 `visionEnabled` 后，`buildOcrContext()` 在视觉开启时仍会被调用，但 `ocrResults` 为空（因为 `ingestImages` 跳过了 OCR），返回 `''`，无副作用。保持现有调用顺序不变，降低改动面。

### 4.8 持久化剥离图片

`src/side_panel/services/chat/history-ops.ts` 的 `appendHistory` 在写 `chrome.storage.local` 前剥离 `image_url` 块：

```typescript
function stripImagesForPersistence(msg: ChatMessage): ChatMessage {
  if (typeof msg.content === 'string') return msg;
  const textParts = msg.content.filter(p => p.type === 'text');
  const text = textParts.map(p => p.text).join('\n');
  return { ...msg, content: text, hadImages: msg.hadImages };
  // hadImages 保留，用于重载后渲染提示；其余内存态字段不写盘
}

export function appendHistory(tabState: TabState, msg: ChatMessage, tabId: number): void {
  // 内存里保留原始带 image_url 的 msg——下一轮发给模型时它要看图
  tabState.conversationHistory.push(msg);
  persistForTab(tabId);
}
```

**关键细节**：内存 `conversationHistory` 保留原始带 `image_url` 的消息。剥离发生在 `persistForTab` 写盘环节——序列化时对每条消息跑 `stripImagesForPersistence`，写盘；内存态不动。示意：

```typescript
function persistForTab(tabId: number): void {
  const tabState = state.getStateForTab(tabId);
  const persistable = tabState.conversationHistory.map(stripImagesForPersistence);
  chrome.storage.local.set({ [keyFor(tabId)]: { ...tabState, conversationHistory: persistable } });
}
```

重载时从 storage 读回的历史：`content` 是文字字符串，`hadImages: true`。渲染时见 `hadImages && !hasActualImageUri` → 显示"[图片已在重启后丢失]"。

### 4.9 聊天气泡渲染

`src/side_panel/ui/dom-helpers.ts` 的 `appendMessage` 已收 `imageUris?: string[]` 参数显示缩略图。视觉消息渲染复用此能力：

- 内存态消息（`content` 是数组）：从 `image_url` 块提取 data URI 数组，传给 `imageUris` 参数
- 重载态消息（`content` 是字符串 + `hadImages:true`）：`imageUris` 传空，但显示一条"图片已失效"灰条

```typescript
function extractImageUrisFromContent(msg: ChatMessage): string[] {
  if (typeof msg.content === 'string') return [];
  return msg.content
    .filter(p => p.type === 'image_url')
    .map(p => p.image_url.url);
}
```

渲染历史消息时（重载场景）遍历 `conversationHistory`，对每条消息：
- `content` 是数组 → 提取图片 URI + 文字，正常渲染
- `content` 是字符串 + `hadImages:true` → 渲染文字 + "图片已失效"提示
- `content` 是字符串 + 无 `hadImages` → 现有纯文字渲染

### 4.10 sw-openai.ts 透传

`src/background/sw-openai.ts` 组装 fetch body 时，`content` 是数组直接透传（OpenAI 兼容格式原生支持），是字符串保持原样。需核对：
- 是否对 `content` 做了 `.slice()` / `.length` / 字符串拼接——若有，加 `typeof content === 'string'` 守卫
- `max_tokens` 计算是否依赖 content 长度——若是，数组 content 跳过或只算文字部分

预期改动量：0~1 处守卫，无逻辑变更。

---

## 5. 错误处理

| 场景 | 处理 |
|---|---|
| `captureVisibleTab` 失败（无 tab / chrome:// 页 / 权限丢失） | catch 后 `appendMessage('error', ...)`，不进预览条 |
| 视觉模型返回错误（模型不支持 image_url） | 走现有 `StreamMessage` 的 `error` 分支，聊天区显示错误消息 |
| 请求体过大（base64 总和 > 10MB） | 发送前 `appendMessage('error', t('error.visionPayloadTooLarge'))` 警告，**不阻断**，继续发送让 API 兜底 |
| 重载后视觉消息图片丢失 | 渲染时 `hadImages && !hasUri` → 显示"图片已失效"灰条 |
| 视觉开启但模型名未填 | 走现有"模型未配置"错误路径，不特殊处理 |

---

## 6. 测试要点

- `ChatMessage.content` 数组形式的类型守卫与序列化
- `ingestImages` 在 `visionEnabled` true/false 下的分叉（true 跳过 `runOCR`）
- `addImageDataUri` 直接注入预览条不触发 OCR
- `sendToAI` 视觉开启时组装出正确的 `MessageContentPart[]`（text 在前，image_url 顺序对应预览条顺序）
- `sendToAI` 视觉关闭时走现有字符串路径（回归保护）
- `stripImagesForPersistence` 剥离 `image_url` 块，保留文字 + `hadImages`
- `persistForTab` 写盘用剥离版，内存 `conversationHistory` 保留原始带图版
- `captureVisibleTab` mock 返回 data URL / mock reject
- `appendMessage` 渲染数组 content 的图片块 + 重载态 `hadImages` 的"图片已失效"
- 现有 OCR 测试全绿（视觉关闭路径不变）
- `visionEnabled` 的 `onSyncChange` 实时切换按钮显隐

---

## 7. 不动的东西

- `handleOcrParse` 服务端 handler（OCR 路径完全保留）
- 现有图片上传/粘贴/拖拽的 UI 入口与事件绑定
- 流式处理 `stream-handler.ts`（assistant 回复仍是文字流）
- `public/manifest.json` 权限（`activeTab` 已够 `captureVisibleTab`）
- 普通聊天历史结构（只是 `content` 类型变宽）
- TTS / podcast / annotation / related-pages 等其它功能

---

## 8. 实现顺序建议

1. **类型层**：`types.ts` / `types.js` 升级 `ChatMessage.content` 联合类型 + `MessageContentPart` + `hadImages`
2. **持久化层**：`history-ops.ts` 加 `stripImagesForPersistence` + 调整 `persistForTab` 写盘剥离、内存保留
3. **截图服务**：新增 `screenshot.ts`
4. **intake 分叉**：`ocr.ts` 加 `addImageDataUri` + `ingestImages` 视觉开启跳过 OCR
5. **发送分叉**：`message-sender.ts` 的 `sendToAI` 组装数组/字符串 content + 请求体软提示
6. **UI 渲染**：`dom-helpers.ts` 渲染数组 content 图片块 + 重载态"图片已失效"
7. **按钮 + 配置**：`index.html` 加按钮、`options` 加复选框、`onSyncChange` 联动显隐
8. **sw-openai 核对**：检查 `content` 字符串假设，加守卫
9. **i18n**：`i18n.js` 加 `settings.vision.*` / `sidebar.visionCapture` / `error.screenshotFailed` / `error.visionPayloadTooLarge` 等 key（zh + en）

---

## 9. 边界与已知限制

- **Claude 原生 API 不支持**：统一用 OpenAI `image_url` 格式，Claude 原生 API 用不同的 `image`+`source` 格式。用户若接 Claude 原生端点（非 OpenAI 兼容端点），视觉不工作。这是可接受边界——项目协议本就是 OpenAI 兼容。
- **图片不持久化**：重启/关闭侧边栏后视觉对话中的图片丢失，只剩文字。这是方案 A 的明确取舍，换取零爆配额风险与低实现复杂度。
- **长页面需手动多次截图**：不做滚动拼接/全页截图，用户自己滚动+多次点按钮。多张图可同轮发送。
- **不做模型能力探测**：勾选"支持视觉"是用户承诺。若模型实际不支持，API 报错由现有错误流展示。
