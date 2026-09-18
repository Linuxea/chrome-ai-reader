# AI SDK Agentic 改造设计文档

**日期**: 2026-09-18
**状态**: Spike 已验证，待实现

---

## 1. 背景与目标

### 1.1 要解决的问题

现有"小🍐子阅读助手"是纯 chatbot：`sw-openai.ts` 手写 SSE 解析，text-in/text-out。代码虽为 agent 预留了类型插槽（`ChatMessage.tool_calls`、`protocol.ts` 注释掉的 `tool_call`/`tool_result` 变体、`AGENT TODO` 标记），但预留的是**纯自定义实现**路线。经决策，改为接入**三方稳定可行的 agentic SDK**，避免自维护 agent loop、工具分片聚合、重试等易错基础设施。

### 1.2 SDK 选型结论

选定 **Vercel AI SDK**（`ai@7` + `@ai-sdk/openai-compatible@3` + `zod@4`）：

| 约束 | AI SDK | OpenAI Agents SDK | LangGraph JS |
|------|--------|-------------------|--------------|
| MV3 SW 可运行/可 IIFE 打包 | ✅ 纯 TS，browser 兼容 | ⚠️ Node 优先 | ❌ 重度 Node 依赖 |
| OpenAI 兼容端点（DeepSeek 等） | ✅ `createOpenAICompatible` | ⚠️ | ⚠️ |
| 内置 agent loop | ✅ `streamText` + `tools` + `stopWhen` | ✅ | ✅ |

### 1.3 目标

- 聊天升级为可选 agent 模式：模型可调用工具（读页面、搜关联页、OCR），多步执行后给出最终回答
- `sw-openai.ts` 手写 SSE 管线**全量替换**为 SDK（保持"单一 delta 解析点"原则——解析点从手写循环移到 SDK 的 `onChunk`）
- 面板 Port 线协议保持兼容：现有 `thinking/chunk/done/error` 不变，启用预留的 `tool_call`/`tool_result` 变体
- agent 关闭时行为与现状等价

### 1.4 非目标

- **不做** `fetch_url` 工具（SW 无 DOMParser，需隐藏 tab 方案，留待二期）
- **不做** provider 能力探测（用户开启 agent 但端点不支持 tools 时，由 API 报错明示，不静默降级）
- **不迁移** embedding 路径（独立配置、独立 port、运行稳定，维持现有 fetch）
- **不做** tool approval/人工确认交互（首批工具均为只读，无 destructive 操作）
- **不做**跨会话 agent 运行（panel 关闭即中止，port disconnect 语义不变）

---

## 2. Spike 验证结论（2026-09-18，全部实测通过）

| 验证项 | 结果 |
|---|---|
| 用 `build-extension.js` 同款 rollup 配置（esbuild es2022 + nodeResolve browser + commonjs）打 IIFE | ✅ 成功；仅 zod 注释位置警告 + zod 内部循环依赖警告，均无害 |
| 体积 | **976KB raw / 180KB gzip**（现 `background.js` 161KB，增量约 +180KB gz，可接受） |
| 完整 agent loop 真跑（mock SSE：reasoning → tool_calls 分片 → 工具执行 → 结果回传 → 二轮流式） | ✅ PASS；两轮 LLM 调用，`arguments` 跨分片正确聚合为 `{"tabId":123}` |
| DeepSeek `reasoning_content` 思考流 | ✅ provider 原生映射：`delta.reasoning_content ?? delta.reasoning` → reasoning 事件 |
| tool_calls 流式分片聚合 | ✅ SDK 内置 `StreamingToolCallTracker` 按索引聚合，无需手写 |
| podcast/annotation 的 JSON 模式 | ✅ `responseFormat: 'json'` 由 provider 序列化为 `response_format: {type:'json_object'}` |
| `abortSignal` | ✅ 原生支持，可直接接 `port.onDisconnect` |

**关键 gotcha（ai@7 字段名与旧版文档不同）**：`onChunk` 流部件 `text-delta`/`reasoning-delta` 的载荷字段是 **`.text`**（非 v4/v5 的 `.textDelta`）；`tool-call` 是 `.toolCallId/.toolName/.input`；`tool-result` 是 `.toolCallId/.output`。

---

## 3. 核心决策摘要

| 项 | 决定 |
|---|---|
| SDK 作用域 | **只进 Service Worker**；panel/content 不引入 SDK，继续走 Port 线协议 |
| 迁移策略 | **全量替换** `sw-openai.ts` 内部实现（chat 流式/JSON 调用全部走 SDK），但**分两步提交**：先行为等价替换（Phase 1-2），后开 agent（Phase 3+） |
| Agent loop | SDK 托管：`streamText({ tools, stopWhen: stepCountIs(8) })`，不自建循环 |
| 工具定义 | `tool()` + zod `inputSchema` + `execute`，execute 包装现有 SW 能力 |
| 线协议 | `StreamMessage` 现有四变体不变；启用并微调预留变体（见 §5） |
| 历史持久化 | agent 请求结束时 SW 在 `done` 消息附带权威 `messages`（assistant+tool 序列），panel 整体追加，**不从 UI 事件重建**（多步序列重建易漂移） |
| Abort | `streamText.abortSignal` ← `port.onDisconnect`；工具执行中 port 断开由 SDK 中止后续步 |
| SW 保活 | 工具事件即时 post 到 port（每次 port 消息重置 30s idle 计时器）；单工具执行超时上限 25s |
| 配置 | `agentMode: boolean` + `enabledTools: string[]`（storage.sync），options 页开关 |
| 不支持 tools 的端点 | SW 捕获 API 错误后 post `errorKey: 'error.toolsNotSupported'`，不静默降级 |
| Embedding | 维持现有手写 fetch，不迁移 |

---

## 4. 模块职责与数据流

### 4.1 改动范围概览

```
src/shared/protocol.ts        ← 启用 tool_call/tool_result/done.messages 变体；AIChatRequest 加 agent 标记
src/shared/types.ts           ← （无改动，tool 字段已预留）
src/background/llm/provider.ts        ← 新增：createOpenAICompatible 工厂（读 storage 配置）
src/background/llm/tools.ts           ← 新增：zod 工具注册表（包装现有能力）
src/background/sw-openai.ts   ← 内部实现换 SDK：streamChatCompletion → streamText/generateText
src/background/service-worker.ts      ← ai-chat port 分流：普通 chat / agent chat
src/side_panel/services/stream-handler.ts  ← 处理 tool_call/tool_result/done.messages 事件
src/side_panel/ui/dom-helpers.ts      ← 工具调用卡片渲染
src/options/                   ← agentMode + enabledTools 设置 UI
src/shared/i18n.js            ← 新 key（zh + en）
package.json                  ← dependencies: ai, @ai-sdk/openai-compatible, zod
```

### 4.2 数据流（agent 模式）

```
panel ──{type:'chat', agent:true, messages}──▶ SW (service-worker.ts)
  └─ sw-openai.ts: streamText({ model, messages, tools, stopWhen, abortSignal,
                                 onChunk: SDK chunk → StreamMessage 映射 })
       ├─ reasoning-delta (.text)        → { type:'thinking', content }
       ├─ text-delta (.text)             → { type:'chunk', content }
       ├─ tool-call (.toolCallId/…)      → { type:'tool_call', … }   ← execute 在 SW 内跑
       ├─ tool-result                    → { type:'tool_result', … }
       └─ finish + result.response.messages → { type:'done', messages: ChatMessage[] }
panel: 追加 done.messages 到 conversationHistory（history-ops），渲染工具卡片
```

普通 chat（agent:false）与 suggest/podcast/annotation 走同一 SDK 管线但不传 tools、done 不带 messages，行为与现状等价。

---

## 5. 协议变更（`shared/protocol.ts`）

```ts
export type StreamMessage =
  | { type: 'thinking'; content: string }
  | { type: 'chunk'; content: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }   // 预留变体启用；input 为已解析对象
  | { type: 'tool_result'; id: string; output: string }               // 预留变体启用
  | { type: 'done'; messages?: ChatMessage[] }                        // agent 请求附带权威消息序列
  | { type: 'error'; error?: string; errorKey?: string };

export interface AIChatRequest {
  type: 'chat';
  messages: ChatMessage[];
  response_format?: ResponseFormat;
  agent?: boolean;                    // true = SW 附加已启用的工具
}
```

> 与原预留注释的差异：`tool_call.arguments: string` 改为 `input: unknown`（SDK 给出已解析对象，UI 展示时序列化）；`done` 增加可选 `messages`。

---

## 6. 工具注册表（首批）

| 工具 | zod inputSchema | execute 包装的现有能力 |
|---|---|---|
| `read_page` | `{ tabId?: number }`（缺省=当前活跃 tab） | `chrome.tabs.sendMessage` 复用 content script 提取（与 panel 提取同一 wire 协议） |
| `find_related_pages` | `{ query: string, limit?: number≤10 }` | 复用 `sw-related-pages.ts` 的 IndexedDB 余弦检索 |
| `ocr_image` | `{ imageBase64: string, mimeType: string }` | 复用 `sw-ocr.ts` 的 `handleOcrParse` 核心 |

execute 返回值一律序列化为 string（LLM 可读），异常捕获后返回错误描述字符串（不 reject——让模型看到失败并自行调整）。

护栏：单工具 25s 超时（`Promise.race`）；`stopWhen: stepCountIs(8)`；工具白名单按 `enabledTools` 过滤后传入。

---

## 7. 面板 UI

- `stream-handler.ts`：`tool_call`/`tool_result` 事件驱动 UI 追加**工具卡片**（可折叠：工具名 + 入参摘要 + 结果摘要 + 耗时），位于对应 assistant 消息之前
- `done.messages` 到达时：`history-ops.appendMessage` 逐条入 `conversationHistory`（`role:'tool'` 消息已可持久化），替换原本"从 chunk 累积重建 assistant"的路径（仅 agent 请求）
- 重载渲染：历史中的 `tool_calls`/`role:'tool'` 消息渲染为同款卡片（只读态）
- Stop 按钮：行为不变（`port.disconnect()`），SW 端 abortSignal 中止 LLM 流 + 跳过未执行的工具步；已完成的步保留在历史

---

## 8. 配置与降级

- options 新增"Agent 模式"区块：总开关 + 三个工具的独立复选框，写 `storage.sync`（`agentMode`, `enabledTools`）
- agent 开启但端点不支持 tools（API 400 且错误信息含 function/tool 字样）→ SW post `errorKey:'error.toolsNotSupported'`，i18n 提示"当前 API 端点不支持工具调用，请关闭 Agent 模式或更换模型"
- `agentMode` 默认 `false`——存量用户升级后行为零变化

---

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| bundle +180KB gz | 已验证可接受；`npm run build` 后核对 `dist/background.js` 体积作为回归项 |
| MV3 SW 在工具执行间隙被回收（30s idle） | 工具事件即时 post（重置计时器）；单工具 25s 超时上限；实测 chrome.tabs.sendMessage/IndexedDB 均产生扩展 API 活动 |
| ai@7 字段名与旧文档不一致（`.text` vs `.textDelta`） | Spike 已实测确认映射表（§4.2），代码内集中在一个 `onChunk` 映射函数 |
| 测试冲击 | fetch-mock 的 SSE fixture **大部分可复用**（wire 格式不变，SDK 仍走同一 HTTP 协议）；请求体断言需微调（SDK 生成标准 OpenAI 体）；agent loop 测试用 mock fetch 双轮 SSE（Spike 的 `runtime-smoke.mjs` 模式可直接搬进 vitest） |
| zod IIFE 打包警告 | 无害（注释位置 + 内部循环依赖），构建输出忽略 |
| SDK 大版本升级破坏字段名 | 映射集中在单一 `onChunk` 回调 + protocol 类型；锁定主版本（`^7`）并在 AGENTS.md 记录字段名 gotcha |

---

## 10. 实现计划

见 `docs/superpowers/plans/2026-09-18-ai-sdk-agentic-migration.md`（Phase 1-6 分步提交，每步可验证）。
