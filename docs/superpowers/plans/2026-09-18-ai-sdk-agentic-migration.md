# AI SDK Agentic 改造实现计划

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Implement task-by-task; run verification after each task.

**Goal:** 用 Vercel AI SDK（ai@7）全量替换 `sw-openai.ts` 手写 SSE 管线，并在其上开启 agent 模式（工具调用 + 多步执行），面板通过现有 Port 协议渲染工具卡片。

**Architecture:** SDK 只进 Service Worker。`streamChatCompletion` 内部实现换成 `streamText`/`generateText`，对外入口（`callOpenAI`/`callSuggestQuestions`/`callEmbedding`）签名不变。Agent loop 由 SDK 托管（`tools` + `stopWhen: stepCountIs(8)`）。面板协议新增 `tool_call`/`tool_result`/`done.messages` 变体。分两段提交：Phase 1-2 行为等价替换，Phase 3-6 开 agent。

**Tech Stack:** TypeScript (strict), Vitest + jsdom, Vercel AI SDK v7, @ai-sdk/openai-compatible v3, zod v4。

**Spec:** `docs/superpowers/specs/2026-09-18-ai-sdk-agentic-migration-design.md`

**Spike 产物参考:** `/tmp/opencode/agentic-spike/`（`src/agent.ts` 事件映射 + `runtime-smoke.mjs` mock 双轮 SSE 测试模式——直接可搬进 vitest）

---

## 文件结构

| 文件 | 责任 | 动作 |
|---|---|---|
| `package.json` | dependencies: `ai`, `@ai-sdk/openai-compatible`, `zod` | 修改 |
| `src/background/llm/provider.ts` | `createOpenAICompatible` 工厂（读 storage.sync 配置） | 新增 |
| `src/background/sw-openai.ts` | 内部换 SDK；新增 agent 入口 | 修改 |
| `src/background/llm/tools.ts` | zod 工具注册表（read_page / find_related_pages / ocr_image） | 新增 |
| `src/shared/protocol.ts` | 启用 `tool_call`/`tool_result`；`done.messages`；`AIChatRequest.agent` | 修改 |
| `src/background/service-worker.ts` | ai-chat port 透传 `agent` 标记与 `enabledTools` | 修改 |
| `src/side_panel/services/stream-handler.ts` | 处理新事件变体 + `done.messages` 入史 | 修改 |
| `src/side_panel/ui/dom-helpers.ts` | 工具卡片渲染（实时 + 历史重载） | 修改 |
| `src/side_panel/services/message-sender.ts` | agent 开启时请求带 `agent:true` | 修改 |
| `src/options/index.html` + sections | Agent 设置区块 | 修改 |
| `src/shared/i18n.js` | 新 key（zh + en） | 修改 |

测试文件：

| 测试文件 | 覆盖 |
|---|---|
| `tests/background/sw-openai.test.js`（如无则新增） | SDK 管线：mock fetch SSE → chunk/thinking/done 映射；responseFormat 序列化 |
| `tests/background/agent-loop.test.js` | 新增：双轮 SSE mock 全 loop（搬 spike 的 runtime-smoke） |
| `tests/background/tools.test.js` | 新增：工具 execute 包装 + 25s 超时 + enabledTools 过滤 |
| `tests/shared/protocol.test.ts` | 新变体类型契约 |

---

## Task 1: 依赖与 provider 工厂

**Files:**
- Modify: `package.json`
- Add: `src/background/llm/provider.ts`

- [ ] **Step 1:** `npm install ai @ai-sdk/openai-compatible zod`（进 dependencies，非 dev）
- [ ] **Step 2:** 写 `provider.ts`：

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const DEFAULT_API_BASE = 'https://api.deepseek.com';

export async function getChatModel() {
  const { apiKey, apiBase, modelName } = await chrome.storage.sync.get(
    ['apiKey', 'apiBase', 'modelName'],
  );
  if (!apiKey || !modelName) return null;
  const provider = createOpenAICompatible({
    name: 'chat-provider',
    baseURL: (apiBase as string) || DEFAULT_API_BASE,
    apiKey,
  });
  return provider.chatModel(modelName as string);
}
```

- [ ] **Step 3:** 验证：`npx tsc --noEmit`

---

## Task 2: sw-openai.ts 行为等价替换（无 agent）

**Files:**
- Modify: `src/background/sw-openai.ts`
- Modify: `tests/`（受影响的 SW fetch-mock 测试）

- [ ] **Step 1:** `streamChatCompletion` 内部改为 `streamText`，事件映射**集中在一个 onChunk 回调**（字段名按 ai@7：`.text`/`.toolCallId`，见 spec §4.2 映射表），`abortSignal` 接 `port.onDisconnect`；删除手写 reader/decoder/line-split 循环
- [ ] **Step 2:** `response_format: {type:'json_object'}` → `responseFormat: 'json'`（wire 上等价，spike 已验证序列化）
- [ ] **Step 3:** `callEmbedding` **不动**；`callOpenAI`/`callSuggestQuestions` 签名不变
- [ ] **Step 4:** 更新/新增测试：mock fetch 返回现有 SSE fixture → 断言 port 收到相同 chunk/thinking/done 序列；请求体断言改为 SDK 生成的标准 OpenAI 体
- [ ] **Step 5:** 验证：`npm run test && npx tsc --noEmit && npm run build`，核对 `dist/background.js` 存在且可加载

---

## Task 3: 协议启用 + SW agent 入口

**Files:**
- Modify: `src/shared/protocol.ts`
- Modify: `src/background/sw-openai.ts`
- Add: `src/background/llm/tools.ts`
- Modify: `src/background/service-worker.ts`
- Add: `tests/background/agent-loop.test.js`, `tests/background/tools.test.js`

- [ ] **Step 1:** `protocol.ts` 按 spec §5 启用 `tool_call`/`tool_result`/`done.messages` 变体，`AIChatRequest` 加 `agent?: boolean`
- [ ] **Step 2:** `tools.ts` 注册三工具（zod inputSchema + execute 包装现有能力 + 25s Promise.race 超时 + 异常转字符串结果）；导出 `getEnabledTools(enabledTools: string[])` 过滤器
- [ ] **Step 3:** `sw-openai.ts` 新增 `callAgent(messages, port, enabledTools)`：`streamText({ tools, stopWhen: stepCountIs(8) })`，`onChunk` 补 `tool-call`/`tool-result` 映射；结束时把 `result.response.messages` 转 `ChatMessage[]` 放进 `done.messages`（用 `await result` 拿 finish 后的 response）
- [ ] **Step 4:** API 400 且错误含 function/tool 字样 → `errorKey: 'error.toolsNotSupported'`
- [ ] **Step 5:** `service-worker.ts`：ai-chat port 读 `msg.agent` + `msg.enabledTools` 分流 `callAgent`/`callOpenAI`
- [ ] **Step 6:** 测试：搬 spike `runtime-smoke.mjs` 模式——mock fetch 双轮 SSE（tool_calls 分片 + tool result 回传断言 + 二轮文本），断言事件序列与 `done.messages` 内容

---

## Task 4: 面板接入（事件 + 历史 + 卡片）

**Files:**
- Modify: `src/side_panel/services/stream-handler.ts`
- Modify: `src/side_panel/ui/dom-helpers.ts`
- Modify: `src/side_panel/services/chat/history-ops.ts`（如需 appendMany）
- Modify: `src/side_panel/services/message-sender.ts`
- Modify: `src/shared/i18n.js`

- [ ] **Step 1:** `stream-handler` 处理 `tool_call`/`tool_result`：向聊天区插入可折叠工具卡片（工具名 + 入参/结果摘要）；`done.messages` 存在时用它整体入史（替代 chunk 累积重建，仅 agent 路径）
- [ ] **Step 2:** `dom-helpers` 历史渲染支持 `tool_calls`/`role:'tool'` 消息 → 只读卡片；`message-sender` 在 `agentMode` 开启时请求带 `agent: true` + `enabledTools`
- [ ] **Step 3:** i18n key：工具卡片标题、展开/折叠、`error.toolsNotSupported`（zh + en）
- [ ] **Step 4:** 验证：`npm run test && npm run lint`

---

## Task 5: Options 设置 + 默认关闭

**Files:**
- Modify: `src/options/index.html` + 对应 section `.ts`

- [ ] **Step 1:** "Agent 模式"区块：总开关 + 三工具复选框 → `storage.sync`（`agentMode` 默认 false, `enabledTools` 默认全选）
- [ ] **Step 2:** 验证：手工加载 `dist/`，开/关 agent 各发一条消息确认行为；`npm run build` 后核对体积（预期 ~1MB raw）

---

## Task 6: 收尾

- [ ] **Step 1:** 删除 `sw-openai.ts` 中已废弃的手写解析残留与 `AGENT TODO` 注释（协议 `protocol.ts` 的预留注释也同步清理）
- [ ] **Step 2:** 更新 `AGENTS.md`：SW chat streaming 段改为 AI SDK 描述；Key Gotchas 增加 ai@7 字段名 gotcha（`.text` 非 `.textDelta`）；Agent Readiness 段改为"已实现"
- [ ] **Step 3:** 全量验证：`npm run test && npm run test:coverage && npx tsc --noEmit && npm run lint && npm run build`
- [ ] **Step 4:** `npx madge --circular --extensions ts,js src/`——确认未引入新循环依赖（现有 1 个已知循环除外）
