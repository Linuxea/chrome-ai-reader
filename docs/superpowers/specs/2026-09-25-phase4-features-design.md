# Phase 4 新功能设计与落地说明（2026-09-25）

对应 `2026-09-25-architecture-review-design.md` §4 的 F1–F13。本文记录**实际落地**的设计、关键取舍与未做部分。

## F1 引用溯源 / F2 长文问答

- 抽取时段落化：`content/paragraphs.ts`（Readability HTML → 段落；无文章时按块元素），存入 `TabState.pageParagraphs`。
- `shared/context-builder.ts`：页面以 `[#N]` 编号段落注入；超出字符预算时按 BM25（拉丁词 + CJK 二元组）选取与问题最相关的段落，并保留开头若干段作为全局语境。历史按预算从新到旧裁剪。取代原先 64000 字截断丢尾部。
- 回答中的 `[#N]` 由 `ui/citations.ts` 转为按钮；点击 → `features/citations.ts` → content script `highlightParagraph` 滚动并闪烁原文。设置 `citations`（默认开）。
- 未做：“总结全文”的 map-reduce（目前靠开头段 + 预算）。

## F3 PDF / 视频字幕

- PDF：Chrome 的 PDF 查看器无法注入 content script，改由侧边栏 `services/pdf-extractor.ts` 直接 `fetch` PDF（`<all_urls>` 权限覆盖跨域；本地文件需“允许访问文件网址”），用**懒加载**的 pdf.js（`services/pdf-loader.ts`，pdf.js 与 worker 均为独立 chunk）解析文字层；`shared/pdf-text.ts` 负责把硬换行的行重组为段落（连字符、CJK 无空格拼接）。判定：URL 路径 `.pdf`，或 content script 无法注入时 `HEAD` 的 `content-type` 为 `application/pdf`。扫描件（无文字层）给出明确错误。
- YouTube：`content/youtube.ts` 在页面内重新获取 watch 页 HTML 读取 `captionTracks`（隔离世界读不到 `ytInitialPlayerResponse`），优先人工字幕、界面语言、英语；先 `fmt=json3`，空则 XML，再退回已打开的“显示文字稿”面板 DOM。字幕按约 45 秒分段并加 `[m:ss]` 时间戳前缀（`shared/youtube.ts`）。
- 引用：视频段落 → content script `seekVideo` 跳转到时间戳；PDF 段落 → 以 toast 展示原文（外部无法滚动 PDF 查看器）。
- 未做：B 站字幕。

## F4 多标签页联合问答

- 输入框旁“附加标签页”选择器（`features/tab-context.ts`），附加的标签页由 `extractTabContent()` 读取（不污染该标签页缓存，单页截断 20000 字），随本次发送注入上下文。

## F5 阅读知识库

- 知识关联面板增加语义搜索（`features/reading-search.ts` → SW `pageRecords:search`），对历史阅读记录做向量检索；Agent 模式提供 `search_reading_history` 工具，实现跨页问答。
- 未做：导出到 Obsidian / Notion（高亮笔记可导出 Markdown，见 F6）。

## F6 持久化高亮与笔记

- `shared/highlights.ts`：TextQuoteSelector（exact + 前后 32 字上下文）与模糊定位；IndexedDB `highlights` store（SW `sw-highlights.ts` 读写）。
- 页面内用 CSS Custom Highlight API 绘制（`content/highlights.ts`），不改页面 DOM；加载时自动还原。
- 侧边栏“笔记”面板（`features/notes.ts`）：列表、跳转、删除、“问 AI”、导出 Markdown。
- 批阅结果以“规范化 URL + 正文哈希”为键缓存在 `annotations` store（SW `annotations:get/save`），同一页面内容不变时重复批阅不再花 token。

## F7 沉浸式双语对照

- `content/immersive.ts` 在每段后插入译文（带专属类名的注入样式；列表项 / 表格单元格内追加以保持结构），按段落批次（每批 ≤10 段 / 3000 字，并发 2）经 `PORT_NAMES.TRANSLATE` 交给 SW `sw-translate.ts` 翻译（快速模型，`translations` store 按段缓存）。未采用 shadow DOM：译文需随正文排版继承页面字体与宽度。右键菜单或侧边栏按钮开关。

## F8 右键菜单与快捷键

- `background/sw-menus.ts`：选区“解释 / 翻译 / 就此提问 / 高亮”，页面“总结 / 沉浸式翻译”。`commands`：`Alt+S` 打开侧边栏，`Alt+Q` 就选区提问。
- 侧边栏可能尚未打开：SW 在用户手势内 `sidePanel.open`，动作写入 `storage.session` 并同时消息通知；`features/panel-actions.ts` 以 id 去重、30 秒过期。

## F9 用量面板

- 所有流式调用透传 `usage`（OpenAI `stream_options.include_usage`、Anthropic `message_delta`），SW `usage.ts` 串行累加到 `storage.local` 按日按模型统计（保留 90 天）；回答下方显示本轮 token，设置页 `usage-panel.ts` 展示汇总。
- `fastModelName`：建议问题、标题、批阅、翻译、测验走快速模型（`purpose: 'light'`）。

## F10 分支对话

- `TabState.branches`：以分叉前一条消息 id（或 `ROOT_BRANCH`）为键保存各条后续；重试 / 编辑不删除旧的后续，而是存为分支（`history-ops.ts` `branchFromId / switchBranch / branchInfo`），分叉处显示 `< 1/2 >` 切换器（`.branch-switch`），事件 `BRANCH_SWITCH` 触发重渲染。

## F11 Agent 模式

- 设置 `agentMode`（默认关）。`services/agent-tools.ts` 定义只读工具：`search_page`、`read_paragraphs`、`get_selection`、`find_related_pages`、`search_reading_history`、`list_open_tabs`、`read_tab`、`highlight_paragraph`。
- 工具循环在 `background/chat-runner.ts`（两家 Provider 的 tool call 统一为 `tool_calls`），工具在侧边栏执行（需要 DOM / 标签页上下文），经端口往返；最多 6 轮。

## F12 学习模式

- 操作栏“测验”按钮（`features/quiz.ts`）：快速模型 + JSON 模式生成 5 道选择题与 6 张闪卡（`quiz.system/user` 提示词，中英）；`shared/quiz.ts` 容错解析与 Anki CSV 导出（含 CSV 转义）。测验卡片不入历史。

## F13 播客去代理化

- 调研结论：火山引擎播客 WebSocket 只接受握手头鉴权。浏览器 WebSocket 不能设头，但扩展可以用 `declarativeNetRequest` 的 `modifyHeaders` 为 `websocket` 请求加头。
- 实现：可选设置 `podcastDirect`（默认关）。SW `background/podcast-direct.ts` 每次会话安装一条 session rule（仅匹配该 wss URL、`tabIds: [-1]` 即非标签页请求），会话结束即移除；帧协议移植为 `shared/podcast-frames.ts`，测试逐字节对齐 `proxy/server.js`。直连在**尚未产生音频**时失败则自动回退本地代理；面板关闭（端口断开）同时中止两条路径。
- 权限：新增 `declarativeNetRequestWithHostAccess`（已有 `<all_urls>`，不新增安装提示）。
