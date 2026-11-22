# 侧边栏 React + shadcn/ui 重写迁移方案

> 状态：**已完成**（全部 5 个 Phase 于 2026-11-22 收口；manifest 入口已切换至 `src/panel/index.html`，旧 `src/side_panel/` 已删除，PURE 服务已迁入 `src/panel/lib/`）
> 日期：2026-11-22
> 范围：`src/side_panel/`（侧边栏全面重写）→ `src/panel/`（React 应用）
> 不动：`src/content/`、`src/background/`、`src/options/`（options 后续另行现代化）

## 0. 决策记录

| 决策项 | 选择 | 理由 |
|---|---|---|
| 技术路线 | React 19 + shadcn/ui + Tailwind v4 | 用户选定；体验上限最高 |
| 范围 | 侧边栏优先 | 用户选定；options 二期 |
| 改进方向 | 微交互动效 + 视觉焕新 + 布局重组 + 设置页现代化 | 用户选定（设置页归二期） |
| 状态管理 | **zustand**（外部 store，chrome.storage.session 持久化中间件） | state.ts 零 DOM、函数式 API，移植成本低；zustand 可在组件外使用（stream-handler 等服务代码继续工作） |
| 动效 | **Motion**（`motion/react`，原 Framer Motion） | 声明式布局动画，Vercel/Linear 同款；尊重 prefers-reduced-motion |
| 图标 | **lucide-react** | 替换 200+ 行内联 SVG，与 shadcn 生态一致 |
| 主题 | **保留 themes.css 多主题令牌体系**，映射进 shadcn 的 CSS 变量约定 | 现有 4 主题 × 明暗 = 8 套配色是资产不是债；shadcn 同为 CSS 变量驱动，天然兼容 |
| 迁移策略 | **并行双轨**：新建 `src/panel/`，旧 `src/side_panel/` 保持可用，完工后切入口 | 扩展全程可加载可回退；CI 绿灯贯穿 |

## 1. 现状盘点（迁移成本基线）

- 侧边栏：58 个 TS 文件 / ~8400 行 + 2467 行 CSS；103 个测试文件（~54 个不受影响，~40 个 DOM 行为测试需转 RTL）
- `platform/`（5 模块）与 `shared/`（除 4 个无害触点）**零 DOM，直接复用**
- services 层 8 个 PURE 文件直接带走：history-ops、agent-tools、quick-action-handler、pdf-extractor、pdf-loader、screenshot、tts/engine、tts/utils
- markdown 渲染管线（marked + DOMPurify → 消毒 HTML 字符串）React 下原样复用

### 三处硬骨头（"DOM 即状态"）

| 模块 | 问题 | React 解法 |
|---|---|---|
| `services/images.ts` | 待发图片存在 DOM 预览条里，发送时从 DOM 读回 | 图片列表进 store；预览条纯渲染 |
| `services/stream-handler.ts` | 流式答案的气泡是 DOM 节点，靠 `isConnected`/`reattach` 维系 | 流式文本进 store；`<Answer>` 组件订阅渲染；port/abort/outcome 注册表保留为纯流控制器 |
| `message-sender.resendUserMessage` | retry/edit 靠遍历 `_chatArea.children` 剪 DOM | 分支数据已在 history-ops（F10）→ truncate + 全量重渲染，天然支持 |

### 必须保留的窗口全局语义

TTS 与播客是"打印机资源"：跨 tab 后台播放、origin tab 回切重挂、pendingSaves/pendingErrors 后台回收。`now-playing` / TTS origin / `_activeStreams` 三个纯注册表是 React 化后唯一要小心的状态，挂在 zustand 之外的全局单例里（不参与 React 生命周期）。

### 事件总线去 DOM 化

`RETRY` / `EDIT` / `GENERATE_SUGGESTIONS` / `ADD_TTS_BUTTON` 等事件现携带 `HTMLElement`，改为携带 `msgId` 数据 payload。`REQUEST_RERENDER` / `CHAT_RERENDERED` / `PODCAST_REBUILD_REQUEST` / `QUIZ_REBUILD_REQUEST` 等命令式重建事件在 React 化完成后**大部分消亡**（状态驱动渲染天然取代）。

## 2. 目标架构

```
src/panel/                     # React 应用（新）
  main.tsx                     # 入口：createRoot + Provider 装配
  App.tsx                      # 布局骨架（Panel / Header / QuickActions / ChatArea / Composer）
  stores/                      # zustand slices
    tabs-store.ts              # per-tab TabState map + activeTabId + storage.session 持久化
    composer-store.ts          # 草稿、待发图片、attached tabs、quote
    stream-store.ts            # 流式中间态（live 文本、thinking、agent 轮次、usage）
    ui-store.ts                # 面板开合、命令弹窗、toast
  components/
    ui/                        # shadcn 原语（button/dialog/sheet/tooltip/…，CLI 生成）
    chat/                      # MessageList / UserBubble / Answer / ThinkingBlock /
                               # AgentTrace / CitationChip / TtsButtons / SuggestChips
    composer/                  # Composer / ImagePreviewBar / QuotePreview / TabChipBar /
                               # CommandPopup / TabPicker
    panels/                    # HistorySheet / NotesSheet / PodcastCard / MiniPlayer /
                               # QuizCard / OutlineCard / ShareModal / TtsIndicator
    layout/                    # Header / QuickActions / ModelStatusBar
  hooks/                       # useComposerKeyboard（IME 安全）、useAutoScroll（stick-to-bottom）、
                               # useStreamingAnswer、useTabSwitch …
  lib/
    stream-controller.ts       # 从 stream-handler 剥离的纯协议半边（port/Outcome/abort）
    send-pipeline.ts           # 从 message-sender 剥离的组装半边（提示词拼装 = 纯逻辑）
src/side_panel/services/…      # PURE services 继续住原地，panel/ 直接 import（跨包只准引 PURE 清单）
src/platform/  src/shared/     # 原样复用
```

分层规则（dependency-cruiser 新增）：`stores ← components ← hooks`，panel 可引 `platform/shared/side_panel-services(PURE)`，禁止引 `ui|features|shell` 旧代码；旧新两个入口文件互不引用。

### 主题映射（themes.css ↔ shadcn）

themes.css 的变量继续作为唯一色源（theme-boot.js 预绘机制不动），在 `panel/styles.css` 加一层别名映射：

```css
@import "tailwindcss";
@theme inline {
  --color-background: var(--bg);
  --color-card: var(--card-bg);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--user-text);
  --color-muted-foreground: var(--text-secondary);
  --color-border: var(--border);
  /* …radius/shadow 同理由 --radius-* / --shadow-* 注入 */
}
```

shadcn 组件用 `bg-background text-foreground` 等语义类，主题切换时 8 套配色全部自动生效，无需 React 参与。

### 视觉方向（二期细化，先立原则）

现有"素简"主题（暖纸底 + 陶土主色 + 宋体标题）有辨识度，但正撞上"AI 生成脸"重灾区（米色底+衬线+陶土色）。焕新原则：**保留"纸上阅读"的产品灵魂，执行层面全面升级**——令牌化间距/字阶/动效曲线、收紧信息密度、消息层级重排；字体从系统宋体升级为有性格的中文屏显方案；动效遵循"动 transform/opacity、一个编排时刻"的纪律。Phase 2 出 2–3 个方向的静态对比稿再定稿。

## 3. 分阶段计划

### Phase 0 — 基建（半天）
- 依赖：`react react-dom zustand motion lucide-react` + dev: `@vitejs/plugin-react tailwindcss @tailwindcss/vite @testing-library/react @testing-library/user-event`
- vite.config.js：React 插件（`jsx: 'automatic'`）、`src/panel/` 新入口 HTML（`side_panel/index.html` 旧入口暂不动）；**继续用 build --watch，不起 dev server**（MV3 CSP 无 HMR 需求，React 生产构建不含 eval，天然合规）
- Tailwind v4 CSS + 主题映射层；shadcn `components.json` 手工配置（CLI 会乱动 tsconfig，不跑 init）
- dependency-cruiser 新增 panel 分层规则；vitest 配 RTL matcher
- 验收：`npm run build` 产出新旧两个可用页面；`npm run lint && npm run test` 全绿

### Phase 1 — 状态层移植（1–2 天）
- `tabs-store`：移植 state.ts 语义（250ms debounce 持久化、消息边界立即 flush、quota 降级、不恢复 in-flight 标志、per-tab 寻址、tab 生命周期清理）
- `composer-store` / `stream-store` / `ui-store`；事件总线 payload 去 DOM 化（msgId 化）
- 三个"DOM 即状态"硬骨头的状态模型在此定稿
- 验收：stores 单测覆盖持久化/恢复/降级路径（平移 state.test.js 场景）

### Phase 2 — 核心对话界面（2–3 天）
- App 骨架 + Header + QuickActions（信息布局重组第一期：快捷操作区收纳为可滚动芯片行）
- MessageList（history 驱动全量渲染 + 分支切换器）、`<Answer>` 流式渲染（80ms 节流 markdown flush、围栏补全、thinking 折叠、agent trace、引用 chips、usage footer）
- Composer（受控草稿、IME 安全 Enter、图片/引用/标签附加、命令弹窗）
- Motion 微交互第一批：气泡入场、流式光标呼吸、面板滑入；auto-scroll stick-to-bottom
- 视觉令牌定稿（对比稿评审）
- 验收：能完成完整对话闭环（发送→流式→引用点击→重试/编辑→分支切换）

### Phase 3 — 功能面板（2–3 天）
- HistorySheet / NotesSheet（抽屉式滑入 + 空态引导）
- QuizCard、PodcastCard + MiniPlayer、OutlineCard、SuggestChips、ShareModal、TtsIndicator
- annotation / immersive / tab-context / panel-actions 状态接线
- 窗口全局资源语义验证（跨 tab TTS/播客不断播、origin 重挂）
- 验收：F1–F14 全功能走查清单通过

### Phase 4 — 切换与收尾（1 天）
- 入口切换：`side_panel/index.html` → React 应用（manifest 不需改，路径不变或改指 panel/）
- 删除 `src/side_panel/` 旧 UI 层（ui/features/shell + DOM-heavy services）；保留 PURE services（原地不动）
- CSS 清理：2467 行手写 CSS → Tailwind + themes.css 令牌
- 测试：~40 个 DOM 测试转 RTL 收口，coverage 阈值校准
- AGENTS.md 更新（新架构、新约定、新坑）

## 4. 风险清单

| 风险 | 缓解 |
|---|---|
| MV3 CSP（禁 eval/内联脚本） | 只用生产构建，不起 dev server；React 19 生产无 eval；shadcn/Motion 均合规；`theme-boot.js` 预绘机制原样保留 |
| 100vh 幽灵滚动条（side panel 已知 quirk） | 移植"html/body 钉死 + 唯一滚动容器 .chat-area + min-height:0"的不变量，写入 CSS 注释与测试 |
| TTS/播客跨 tab 语义回归 | 三个全局注册表不进 React 生命周期；Phase 3 专项走查 |
| 流式渲染性能（长答案 markdown 重排） | 保留 80ms 节流 flush + 围栏补全；React.memo 消息行；增量渲染仅 live 气泡 |
| 双轨期包体翻倍 | 构建产物新旧两个 HTML 各自引用各自 chunk，无交叉；切换即删旧 |
| 测试大面积红灯 | 分阶段：每 Phase 结束保持全绿；DOM 测试随对应功能迁移而转写，不一次性重写 |
| `i18n.js` 的 `applyTranslations` 扫 DOM | React 侧直接调 `t()`；`loadLanguage` 在无 data-i18n 页面为无害空扫 |
| Chrome 侧边栏宽度多变（300–500px） | 布局从Day one 以 320px 为基准设计，quick chips 可换行/收纳 |

## 4.5 Phase 4 调色板焕新（大胆焕新方向，定稿记录）

用户选定"大胆焕新"：冷调纸白/墨色 + 无衬线屏显字（字体已在 panel/styles.css 落地）。Phase 4 在 themes.css 层面刷新各主题的令牌值。原则与具体方案：

- **保留**：3 主题（sujian/ocean/forest）× 明暗的结构、令牌名（组件零改动）、theme-boot 预绘机制
- **素简（默认主题）焕新**：暖米色 + 陶土撞上"AI 生成脸"重灾区 → 转向"冷纸白 + 墨黑 + 焦茶主色"：`--bg: #faf9f7`（冷纸白）、`--card-bg: #ffffff`、`--text: #1f1d1a`（暖墨）、`--primary` 从 `#c07842` 转向更克制的深焦茶 `#7c5230`、border 转中性灰阶；深色模式用"暖炭"而非纯黑
- **ocean / forest** 按同一纪律校准对比度与饱和度，去米黄底
- 验收：WCAG AA（正文 4.5:1），深浅两模式各截图对比；share-card 的 accent 注入自动跟随


## 5. 交付物清单

- [ ] `docs/design/react-panel-migration.md`（本文档，随实施更新状态）
- [ ] `src/panel/` React 应用 + shadcn 组件
- [ ] 平移/新写的 stores 与 hooks 测试
- [ ] 全功能走查清单（F1–F14）
- [ ] 更新后的 AGENTS.md
