# 架构升级实施计划（2026-09-25）

对应设计：`docs/superpowers/specs/2026-09-25-architecture-review-design.md`。
原则：每个 Phase 可独立合并、独立回滚；每步都保持 `npx tsc --noEmit`、`npm run test`、`npm run build` 通过。

## Phase 0 — 止血（约 1–2 天）✅ 已完成（2026-09-25）

> 0.7 只做了文案修正与导出脱敏；密钥迁移到 `storage.local` 仍在 Phase 2.1。

| # | 任务 | 对应问题 | 验收 |
|---|------|----------|------|
| 0.1 | `side_panel/ui/markdown.ts`（依赖 DOM，故不放 shared）：`renderMarkdown()` = marked + DOMPurify + 链接/外链图片策略；替换所有 `marked.parse → innerHTML` | S1 | 单测：`<img onerror>`、`javascript:` 链接、外链图片、`<style>` 均被处理 |
| 0.2 | 聊天历史只存 Markdown 源；旧 HTML 记录加载时经 `renderMarkdown` 的净化器 | S1 | 旧记录可加载且不执行注入内容 |
| 0.3 | `ChatMessage.id` + DOM `data-msg-id`；`truncateHistoryFromUserContent` → `truncateHistoryFromId` | C1 | 单测：两条相同内容的用户消息，重试第一条时 DOM 与历史一致 |
| 0.4 | `requestChunk` 显式取消；删除错误注释 | C2 | 单测：clear 后所有 promise 在同一 tick 内 resolve |
| 0.5 | 修复 `scripts/watch-iife.js`（复用 `build-extension.js` 的入口解析与 esbuild 插件）；更新 AGENTS.md | C3 | `npm run dev` 修改 `content/index.ts` 后 `dist/content.js` 更新 |
| 0.6 | proxy `listen(PORT,'127.0.0.1')` + Origin 校验 | S3 | `tests/proxy` 新增 Origin 拒绝用例 |
| 0.7 | 设置页文案修正；导出默认脱敏 | S2（部分） | 导出 JSON 默认不含 `*Key`/`accessKey` |

## Phase 1 — 护栏（约 2–3 天）✅ 已完成（2026-09-25）

> 分层用 dependency-cruiser（按真实解析路径检查，含 type-only import 与循环）而非 `eslint-plugin-boundaries`；ESLint 专注代码规则。
> 1.3 只把 `global-events` / `tab-switch-handler` 迁入 `shell/`，`main.ts` 仍是入口（作为组合根的一部分，不被任何模块 import）。
> 1.5 顺带修复：`annotation.user`、`podcast.meta`、`default.custom` 三处内联提示词收口到 `prompts.ts`；`getPrompt` 改为单遍替换（原实现会展开值里的 `$&` 并重复展开占位符）。

1. GitHub Actions：`npm ci` → `tsc --noEmit` → `eslint` → `vitest run --coverage` → `npm run build`，另起 job 安装 `proxy/` 依赖跑 proxy 测试。
2. 引入 `typescript-eslint`（让 ESLint 真正检查 `.ts`）+ `eslint-plugin-boundaries`，按设计 §3.1 分层配置，先 warn、清零后改 error。
3. 新建 `side_panel/shell/`，迁入 `ui/global-events.ts` 和 `main.ts` 中的装配代码，消除 `global-events ↔ tab-switch-handler` 环。
4. 生产构建关闭 inline sourcemap（dev 保留）。
5. 测试：扫描 `src/**` 中内联 LLM 提示词字面量的守卫测试（C6）。

## Phase 2 — 基础设施（约 1–2 周）

1. **Settings**：`shared/settings.ts`（schema + 默认值 + 存储区 + 敏感标记 + 版本迁移）；密钥迁移到 `storage.local`（S2、A2）。
2. **类型化 RPC**：`platform/rpc.ts`（`defineStream/defineCall/registerStream/registerCall`，AbortSignal、sender 校验、统一错误结构）。按通道逐个迁移：`embedding` → `suggest-questions` → `ai-chat` → `tts` → `podcast-*` → `annotation` → 一次性消息（A1、S5）。
3. **SSE**：抽出 `shared/sse.ts` 纯函数 + 空闲超时 + `finish`/`usage` 消息（C5）。
4. **IndexedDB 统一库**：`chats`、`messages`、`pages` store + 迁移旧 `chatHistories` / `tabState_*`；`storage.session` 只存指针；写入失败统一提示（C4）。

## Phase 3 — 核心重构（约 1–2 周）

1. `side_panel/core/`：`ConversationStore`（id/parentId 分支）、`ChatSession` 状态机、`SessionRegistry`；`stream-handler.callAI` 拆为 session + `ui/MessageView`（A4）。
2. 合并 `state.subscribe` 与 `events.ts`；事件载荷改为数据（A3）。
3. `ContextBuilder`：token 预算、长页分块、历史压缩；批阅改为"摘要 + 邻段"上下文（A5）。
4. `background/providers/`：`openai-compatible` 迁入，新增 `anthropic`、`ollama`；模型档案 + 功能路由（A7）。

## Phase 4 — 新功能（按优先级）

F1 引用溯源 → F2 长文问答 → F4 多标签页对比 → F8 右键菜单/快捷键 → F10 分支对话 → F6 高亮笔记 → F5 阅读知识库 → F3 PDF/字幕 → F7 双语对照 → F9 用量面板 → F12 学习模式 → F11 Agent 模式 → F13 播客去代理化。

每个功能按惯例先写 `docs/superpowers/specs/<date>-<feature>-design.md` 再实施。
