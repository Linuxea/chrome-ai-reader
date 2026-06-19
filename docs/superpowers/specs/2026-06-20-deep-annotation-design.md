# 深度批阅（Deep Annotation）设计文档

**日期**: 2026-06-20
**状态**: 设计已对齐，待实现
**阶段**: Phase 1（三 idea 演进主线的第一期，详见"演进路径"）

---

## 1. 背景与目标

### 1.1 要解决的问题

现有"小🍐子阅读助手"的 AI 能力都是**被动式、整页级**的——用户问、AI 答；总结、翻译、问答都是对整篇文章的宏观处理。缺少一种能力：**AI 主动、实时地为读者提供字面意思之外的深度视角**。

用户阅读新闻、技术博客、观点文章时，常常读到的只是字面信息，看不到：
- 数据的水分（30% 提升相对什么基线？）
- 被忽略的对立面（反方观点、利益相关方视角）
- 推理的漏洞（相关性≠因果、样本不足、跳步推理）

### 1.2 目标

提供一个**「深度批阅」**功能：用户在侧边栏点一个按钮，AI 主动扫描全文，对关键句子高亮并附加深度视角批注，像批改试卷一样。用户点击高亮处的图标即弹出批注气泡，获得批判/反方/漏洞三类视角。

### 1.3 非目标

- **不做**被动式查词/选区解释（那是术语悬浮卡的范畴，是另一条产品线）
- **不做**滚动触发的渐进式批注（第一版用一键全批；滚动触发留作未来优化）
- **不做**批注的跨页面持久化（批注只存在于当前页面生命周期，刷新即清除）
- **不做**批注的云端同步/分享

---

## 2. 核心决策摘要

| 项 | 决定 |
|---|---|
| 功能形态 | 主动式深度阅读批注（形态三：全文高亮 + 点击弹出气泡） |
| 视角类型 | 批判质疑（critique）+ 反方观点（counterpoint）+ 逻辑漏洞（flaw） |
| 触发方式 | 用户点击侧边栏「深度批阅」按钮，一键全批 |
| 架构 | 方案 B：三层分离（侧边栏 feature + content 模块 + background port） |
| 分块策略 | 策略 Y：每次请求都带全文上下文，但只批注指定段落；逐段渐进渲染；不设上限 |
| 返回格式 | 每段一次性返回 JSON object（非流式），配 `response_format: json_object` |
| 气泡触发 | 点击图标才弹（不悬停即弹，避免误触） |
| 气泡隔离 | Shadow DOM + `anno-` 前缀，隔离宿主页面样式 |
| 气泡内追问 | 保留"在对话中追问"按钮，点击把批注内容带入侧边栏输入框 |
| 完成后再点按钮 | 清除全部批注，回到 idle 态 |
| 批注语气/语言 | 中文，犀利但不刻薄，宁缺毋滥，1-2 句 |

---

## 3. 模块职责与数据流

### 3.1 三个新模块

**① 侧边栏 feature：`src/side_panel/features/annotation.ts`**
- 注册「深度批阅」按钮点击事件
- 点击后：向当前 tab 的 content script 发 `startAnnotation` 消息
- 管理按钮状态机（idle → annotating → done → idle）
- 监听 content script 回传的进度消息，更新按钮文案（"批阅中... 已批阅 3/8 段"、"✓ 批阅完成（共 12 处）"）

**② content script 模块：`src/content/annotation.ts`**
- 接收 `startAnnotation` / `clearAnnotation` 消息
- 提取页面正文，**按段落分块**（保留段落语义边界）
- 对每个段落：通过 `chrome.runtime.connect('annotation')` 发请求，携带**全文上下文 + 当前段落**
- 每拿到一段结果：在页面 DOM 上高亮关键句 + 挂图标，渐进渲染
- 管理气泡的开关（同时只开一个）
- 全部完成：向侧边栏回报总数

**③ background port：`annotation`（在 `service-worker.ts` 注册）**
- 收到 `{type:'annotate', fullArticle, chunkIndex, chunkText}`
- 组装 system + user prompt（见第 4 节）
- 调 `sw-openai.callOpenAI`，参数 `response_format: { type: 'json_object' }`
- 解析返回 → 通过 port 回传 `{type:'annotated', chunkIndex, annotations: [...]}`

### 3.2 数据流（一次完整批阅）

```
用户点「深度批阅」
   │
   ▼ chrome.tabs.sendMessage(tabId, {action:'startAnnotation'})
[content annotation.ts]
   │ 1. 提取正文 → 分成 N 段（保留全文文本 fullArticle）
   │ 2. 回报侧边栏 {action:'annotationProgress', total: N}
   │ 3. 对第 k 段（k=0..N-1）：
   │      port = chrome.runtime.connect('annotation')
   │      port.postMessage({type:'annotate', fullArticle, chunkIndex:k, chunkText})
   │      ← port.onMessage: {type:'annotated', chunkIndex:k, annotations:[...]}
   │      → 高亮 + 挂图标（渐进渲染）
   │      → 回报侧边栏 {action:'annotationProgress', done:k+1}
   │ 4. 全部完成 → 回报侧边栏 {action:'annotationDone', count: 总批注数}
   ▼
[background port 'annotation']
   │ 组装 prompt（全文上下文 + 指定段落 + 三视角要求）
   │ → callOpenAI(messages, port, {response_format:{type:'json_object'}})
   │ → 解析 JSON → port.postMessage({type:'annotated', chunkIndex, annotations})
   ▼
[content annotation.ts] 渲染到页面 DOM
   │
   ▼ 用户点击图标
弹出气泡 → 用户阅读 → 点✕/点别处关闭
   │ 用户点"在对话中追问"
   ▼ chrome.runtime.sendMessage({action:'annotationToChat', text})
[侧边栏] 把批注填入输入框
```

---

## 4. AI Prompt 设计与数据契约

### 4.1 批注数据结构（新增到 `src/shared/types.ts`）

```typescript
/** 三类深度视角 */
export type AnnotationPerspective = 'critique' | 'counterpoint' | 'flaw';
//                         批判质疑     反方观点        逻辑漏洞

/** 单条批注 */
export interface Annotation {
  id: string;                    // crypto.randomUUID()，content 端生成
  perspective: AnnotationPerspective;
  /** AI 返回的原文句子，用于文本匹配定位（必须原样引用） */
  quote: string;
  /** 批注正文，1-2 句 */
  comment: string;
}

/** 一次段落批注请求的返回 */
export interface AnnotationResult {
  chunkIndex: number;
  annotations: Annotation[];     // 该段可能没有值得批的，返回空数组
}
```

视角与图标/标签的映射（content 渲染时用）：

| perspective | 图标 | 中文标签 |
|---|---|---|
| `critique` | 🤨 | 批判 |
| `counterpoint` | ⚖️ | 反方 |
| `flaw` | 🔍 | 漏洞 |

### 4.2 Prompt 设计（background 端组装）

**System prompt（固定）**：

```
你是一位严谨、犀利但不刻薄的阅读批注员。你的任务是对用户提供的
文章段落提供三类深度视角的批注，帮助读者看到字面之外的东西。

三类视角：
- critique（批判）：质疑数据来源、样本、基线、因果关系等。只批真正
  有问题的，不为了批而批。
- counterpoint（反方）：提出作者忽略或回避的对立观点、利益相关方视角。
- flaw（逻辑漏洞）：指出推理跳步、前后矛盾、偷换概念、循环论证。

要求：
1. 只批真正有价值的点——宁缺毋滥。没有值得批的句子就不要硬凑。
2. 每条批注的 quote 必须是段落中真实存在的连续句子（原样引用，不可改写或缩写）。
3. comment 控制在 1-2 句，锋利、具体、有信息量，不要空话套话。
4. 返回 JSON，不要任何额外文字。
```

**User prompt（每次请求，全文上下文 + 指定段落）**：

```
以下是完整文章作为上下文：

<full_article>
{{全文文本}}
</full_article>

请只对【第 {{k}} 段】进行批注。该段内容：

<target_chunk>
{{第k段文本}}
</target_chunk>

返回格式（JSON object）：
{
  "annotations": [
    {
      "perspective": "critique" | "counterpoint" | "flaw",
      "quote": "段落中原样引用的句子",
      "comment": "你的批注，1-2句"
    }
  ]
}

如果该段没有值得批注的点，返回 {"annotations": []}。
```

**调用参数**：`response_format: { type: 'json_object' }`（与现有 `podcast-llm` 一致）。

### 4.3 Prompt 关键设计点

1. **"宁缺毋滥"写进 system prompt**：质量关键。不强调的话 AI 会每段硬凑，满屏气泡反成噪音。
2. **quote 必须原样引用**：content 要拿它去 DOM 文本匹配定位高亮。AI 改写/缩写会导致匹配失败。
3. **全文上下文用 XML 标签包裹**：`<full_article>` 与 `<target_chunk>` 分隔，帮 AI 区分参考背景与批注对象。
4. **没有值得批的就返回空数组**：不是每段都有料。返回空时 content 不渲染任何气泡，该段保持原样。

---

## 5. 气泡 UI 与交互

### 5.1 视觉结构

**不点击时（原文上的标记）**：

```
...该模型性能提升 30%❗...研究表明喝咖啡降低风险❗...
```

- 关键句用 `<mark class="anno-mark">` 包裹，柔和黄色背景
- 句末紧贴小图标按钮（🤨/⚖️/🔍，由 perspective 决定）
- 图标按钮有轻微阴影/边框，提示可点

**点击图标后（气泡）**：

```
        ┌──────────────────────────────┐
        │ 🤨 批判                    ✕ │  ← 头部：图标+类型标签+关闭
        │──────────────────────────────│
        │ 30% 是相对什么基线？常见的    │  ← 批注正文
        │ 水分手法是挑弱基线。          │
        │──────────────────────────────│
        │ ↩ 在对话中追问                │  ← 底部：追问按钮
        └──────────────────────────────┘
```

- 气泡 `position: absolute` 定位在图标附近
- CSS 伪元素画小三角箭头指向图标
- 同时只开一个气泡（点新的自动关旧的）

### 5.2 交互流程

```
点击「深度批阅」
    ↓
按钮态：idle → "批阅中...（已批阅 3/8 段）"
    ↓ content 边批边渲染高亮+图标（渐进出现）
全部完成
    ↓
按钮态：→ "✓ 批阅完成（共 12 处）"
    ↓
用户阅读 → 看到高亮+图标 → 点击图标
    ↓
气泡弹出（带动画）→ 阅读批注 → 点✕或点别处关闭
    ↓
点"在对话中追问" → 批注内容带入侧边栏输入框
```

### 5.3 CSS 注入策略

气泡和高亮用**自定义元素 + Shadow DOM** 包裹，彻底隔离宿主页面样式：
- 所有 class 用 `anno-` 前缀（anno-mark / anno-bubble / anno-icon）
- Shadow DOM 内注入完整 CSS，不受宿主 `!important` 影响
- 高亮 `<mark>` 因要包在原文文本节点里，用前缀 class + 克制样式，避免破坏原文排版

**为什么 Shadow DOM**：宿主网站 CSS 可能用 `* { }` 或 `!important`，普通注入会被覆盖；气泡的动画/定位/字体需完全自控；这是 Chrome 扩展注入复杂 UI 的标准做法。

### 5.4 样式基调

- 第一版用**硬编码中性配色**作为 fallback（浅色背景、深色文字、三类视角各自的强调色）
- 不联动多主题（ocean 等），保证第一版稳健可读；联动主题留作增量优化
- 后续如需联动主题，通过 CSS 变量驱动

### 5.5 按钮状态机

```
idle ──click──▶ annotating ──done──▶ done
                    │                   │
                  error               click ──▶ 清除批注 ──▶ idle
```

- `idle`：按钮显示「深度批阅」
- `annotating`：按钮禁用，显示「批阅中...（已批阅 k/N 段）」
- `done`：按钮显示「✓ 批阅完成（共 N 处）」；再点 → 清除全部批注 → 回 `idle`
- `error`：批阅中某段失败达到阈值 → 显示「批阅失败，点击重试」

---

## 6. 边界与错误处理

### 6.1 文本匹配定位失败

AI 返回的 `quote` 在该段 DOM 里文本匹配不到时（AI 偶尔会轻微改写）：
- **降级策略**：把该批注挂到**段落首部**（块首），用一个浮动图标表示"此段有一条批注"，点击展开内容
- 不丢弃批注（信息有价值），但视觉上不强行高亮不存在的句子

### 6.2 单段批注请求失败

- 单段失败**不中断**整体批阅流程（其他段继续）
- 失败段标记为"未批阅"，侧边栏按钮在完成后显示"X 段批阅失败，点击重试"（可选增强；第一版可只记 console.error）
- 借鉴 `related-pages.ts` 的失败熔断思路：连续失败 N 次（如 3 次）暂停并提示，避免无意义重试

### 6.3 极长文档

- **不设上限**（用户明确 token 不是问题）
- 段落数很多时（如 50+ 段），请求是串行还是并行？
  - 第一版**串行**（逐段请求 + 渐进渲染），实现简单、顺序可控、对 API 友好
  - 并行优化留作未来（需处理并发限流）

### 6.4 上下文窗口超限

- 极端长文（如 5 万字）单次请求的 fullArticle 可能超模型上下文窗口
- 第一版**不主动处理**（用户场景以常规文章为主）；如触发 API 报错，按 6.2 的单段失败处理

### 6.5 页面刷新 / 导航

- 批注只存在于 content script 的内存和已注入的 DOM
- 页面刷新或 SPA 导航后批注自然清除，侧边栏按钮回到 `idle`
- 第一版不做持久化（非目标）

### 6.6 多 tab / 多 side panel

- 批阅针对**当前激活 tab**，通过 `chrome.tabs.query({active:true, currentWindow:true})` 定位
- 切换 tab 不会影响其他 tab 已有的批注（各 tab 的 content script 独立）

---

## 7. 文件改动清单

### 7.1 新增文件

| 文件 | 职责 |
|---|---|
| `src/side_panel/features/annotation.ts` | 侧边栏 feature：按钮、状态机、协调 |
| `src/content/annotation.ts` | content 模块：分块、请求、高亮、气泡渲染 |
| `src/background/sw-annotation.ts` | background handler：prompt 组装 + 调 OpenAI |
| `src/side_panel/features/annotation.css` | 按钮样式（气泡样式在 content 端 Shadow DOM 内） |
| `tests/side_panel/features/annotation.test.ts` | 侧边栏 feature 单测 |
| `tests/content/annotation.test.ts` | content 模块单测（分块/匹配/渲染抽纯函数） |
| `tests/background/sw-annotation.test.ts` | background handler 单测（prompt 组装/JSON 解析） |

### 7.2 修改文件

| 文件 | 改动 |
|---|---|
| `src/shared/types.ts` | 新增 `AnnotationPerspective` / `Annotation` / `AnnotationResult` |
| `src/background/service-worker.ts` | 注册 `annotation` port，路由到 `sw-annotation.ts` |
| `src/content/index.ts` | 增加 `startAnnotation` / `clearAnnotation` 消息分发 |
| `src/side_panel/index.html` | 增加「深度批阅」按钮 DOM + CSS 引用 |
| `src/side_panel/main.ts` | 调用 `initAnnotation()`，接线按钮 |
| `src/shared/i18n.js` | 增加 `annotation.*` 系列 i18n key |

### 7.3 构建配置

- `build-extension.js` 与 `scripts/watch-iife.js` 无需改动：content/background 仍走 IIFE 打包，新模块通过 `import` 合入即可
- vitest 配置无需改动

---

## 8. 测试策略

遵循项目现有测试哲学（核心模块 80%+ 覆盖）：

| 模块 | 重点测试 |
|---|---|
| `annotation.ts` (side panel) | 按钮状态机转换、消息收发、进度更新 |
| `annotation.ts` (content) | 段落分块逻辑、文本匹配定位（含失败降级）、气泡开关互斥 |
| `sw-annotation.ts` | prompt 组装正确性、JSON 解析、空数组处理、异常返回兜底 |

content 端的 DOM 操作（高亮包裹、气泡渲染）抽成纯函数单测，不依赖真实页面。

---

## 9. 演进路径（三 idea 主线）

本次是三 idea 演进主线的 **Phase 1**，共享底层基础"段落级 AI 查询引擎"：

```
Phase 1（本次）：深度批阅 — 一键全批 + 全文上下文 + 气泡
      │ 打地基：content 注入 + background port + 段落级查询
      ▼
Phase 2：对比阅读模式 — 复用 Phase 1 的段落查询服务，加并列布局
      ▼
Phase 3：深读模式 — 复用前两期的 content script 经验，加 DOM 重排
```

Phase 1 设计为可复用：content 的"段落→请求→渲染"管线、background 的 annotation port、批注数据结构，Phase 2/3 都能直接复用或扩展。

---

## 10. 未决事项

无。所有核心决策已在设计对话中对齐。实现阶段如遇新问题，按"小决策就地定、大决策回到用户"原则处理。
