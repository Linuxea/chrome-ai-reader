# 设置页 React 迁移方案（二期）

> 状态：**已完成**（全部 4 个 Phase 于 2026-11-24 收口；旧 DOM 模块与 options.css 已删除，React 应用是唯一实现）
> 日期：2026-11-24
> 范围：`src/options/`（设置页现代化，侧边栏二期收尾）→ React 应用
> 不动：`src/content/`、`src/background/`、`public/manifest.json`（Vite 多页构建保持 `src/options/index.html` 输出路径，manifest 零改动）
> 前置：`docs/design/react-panel-migration.md`（一期，已完成 2026-11-22）

## 0. 决策记录

| 决策项 | 建议 | 理由 |
|---|---|---|
| 技术路线 | 与 panel 同栈：React 19 + Tailwind v4 + zustand + lucide-react | 一期验证过的配方（`docs/design/frontend-stack-2026.md`）；**零新依赖**（react/zustand/tailwind/lucide 均已在 package.json） |
| 组件方案 | 手写 Tailwind 语义类组件，**不引 shadcn CLI** | panel 实际落地也未用 CLI 原语——`components/ui/` 并不存在，AGENTS.md 的描述滞后；沿用现状 |
| 状态管理 | **单一 `settings-store`**（zustand：草稿值 + loaded + 字段级 persist + saving 反馈） | 设置页是一张表单，不需要 panel 的 7-store 规模；用量表、快捷指令用 section 局部状态 |
| 迁移策略 | **分支内就地替换**：index.html 第一步就切 React 骨架，旧 TS 模块原地保留保测试绿，Phase 3 一次性删除 | 全部面 ~990 行，双 HTML 双轨不值当；旧模块不再被引用但测试继续跑，CI 全程绿 |
| 保存语义 | **全部即时保存**（D-2 用户拍板 2026-11-24）：开关/下拉 change 即写，文本字段防抖落盘；无保存按钮 | 现代设置页直觉；panel 全程热生效；代价是校验从"阻断保存"降级为"字段级提示"，见 §1.2 |
| i18n | 组件直调 `t()` + `useLang()` 订阅重渲染；`data-i18n` 属性随旧 HTML 消失 | panel 同款；语言切换即时生效反而比现在更干净 |
| 样式 | `@theme inline` 令牌映射块从 `panel/styles.css` 抽成共享 partial，两页同源 | 消除双页样式漂移；themes.css 仍是唯一色源，theme-boot.js 预绘不动 |

## 1. 现状盘点（迁移成本基线）

- 13 个 TS 文件 / **990 行** + `index.html` 245 行（静态 DOM + `data-i18n`）+ `options.css` 597 行手写 CSS
- 全手写 DOM：模块级 `getElementById` + `addEventListener`；`quick-commands-editor.ts` 是"DOM 即状态"型（innerHTML + escapeHtml + 事件委托 + `editingIndex` 模块级变量）
- 5 个测试文件已在（`tests/options/`：llm / tts-suggest / quick-commands / import-export / usage + helpers）——语义资产集中在这些测试里
- `platform/settings.ts`（readSettings/writeSettings/onSettingsChange/SETTING_DEFAULTS/SECRET_KEYS）与 `shared/`（i18n/theme/format/tts-cache/usage-stats/download）**零 DOM 依赖层直接复用**

### 1.1 各 section 与旧模块对照

| 旧模块 | 职责 | 迁移要点 |
|---|---|---|
| `theme-settings.ts` | 主题卡选择 / 明暗切换 / 语言选择 | applyTheme/getThemeState 照用；语言切换改 `useLang()` 驱动重渲染 |
| `llm-settings.ts` | provider/apiKey/apiBase/modelName/systemPrompt + citations/webSearch/agentMode + 刷新模型 | provider 跟随 placeholder；校验进 store；fetchModels 走 SW message 不变 |
| `tts-settings.ts` | TTS 凭据 + ttsAutoPlay/podcastDirect + 缓存量显示/清除 | estimateTtsCacheBytes/clearTtsCache 照用 |
| `suggest-settings.ts` / `composer-tools-settings.ts` | 单开关，即时保存 | 最简单，先行样板 |
| `quick-commands-editor.ts` | CRUD + 内联编辑表单 | 全部重写为受控组件；`COMMANDS_KEY` storage.local 语义不变 |
| `usage-panel.ts` | 用量表（1/7/30 天）+ 清空 | summarizeUsage 照用；表格 JSX 化 |
| `import-export.ts` | 导出（secrets 脱敏）/ 导入（不清缺失密钥） | 逻辑抽成纯函数 `lib/backup.ts`，IO 壳留组件层 |
| `fields.ts` / `status.ts` / `index.ts` | DOM 注册表 / toast / 编排 | 字段注册表消亡（store 取代）；status → `StatusToast` 组件 |

### 1.2 保存语义（定稿：全部即时保存，D-2）

保存按钮**取消**。两条时序规则 + 一张字段表：

- **开关/下拉**：change 即 `writeSettings`（provider 切换同时刷新 placeholder 提示）
- **文本/密钥字段**：失焦（blur）或 500ms 防抖后落盘，取先到者；失焦时按旧 collect 语义决定 set 还是 **remove**（空值 → remove，不写空串）

| 字段 | 时序 | 备注 |
|---|---|---|
| 全部 checkbox（citations / webSearch / agentMode / ttsAutoPlay / podcastDirect / suggestQuestions / composerTools 四项） | change 即写 | composerTools 空数组合法（= 全收进 "+" 菜单） |
| provider / language / themeName / darkMode | change 即写 | 与现状一致 |
| apiKey / apiBase / modelName / systemPrompt / TTS 五字段 | 防抖 + 失焦 | 空 → remove（平移旧 collect 语义） |
| quickCommands（storage.local）/ TTS 缓存清除 / 用量清空 | 操作即写 | 与现状一致 |
| exportIncludeSecrets | **不落盘** | 只是导出对话框选项 |

**校验策略的降级与升级**（原来靠阻断保存，现在不能阻断了）：
- apiKey 必填：清空并失焦 = 真的清掉（remove），扩展回到未配置态——下次发送时 panel 的 `error.noApiKey` 是明确反馈，不再硬拦
- `sk-` 前缀启发式（无自定义 apiBase 时）：从**阻断**降级为字段旁的**非阻断内联提示**（Ollama 等本地端点的 key 本就不带 sk- 前缀，旧硬拦本来就是误伤）
- 保存成功/失败反馈：字段级轻量 ✓（1s 淡出）+ 失败走 StatusToast——dirty 指示与 `beforeunload` 离开提醒**整个消亡**（不再存在"未保存"状态）

**微妙语义**（各来自真实 bug，平移时逐条配测试）：
- retired keys（`visionEnabled` / `ocrApiKey` / `fastModelName`）：原来每次保存顺带清除 → 改为**页面加载时一次性清扫**（挂 `settings-store.load()`）
- 导出默认剔除 secrets（checkbox opt-in）；导入对备份缺失的 key **不清除**（secrets 与非 secrets 都是），checkboxes 缺失回 `defaultChecked`——导入后**统一落盘**（不再有"导入改了界面、没保存白改"的窗口）
- `webSearch` 默认开：现在靠 HTML `checked` 属性（`readStoredSettings` 不施默认值）→ React 版改用 `readSettings()`（`SETTING_DEFAULTS` 兜底），quirk 消亡但需一条"从未保存过"的加载测试
- `composerTools` 缺失/非数组 → 全显示
- `fetchModels` 自动触发：apiKey 失焦落盘且值非空时刷新一次 + 导入后一次；刷新按钮仍是主路径

## 2. 目标架构

```
src/options/
  index.html              # 极薄：themes.css + options 样式 + theme-boot.js + <div id="root"> + ./main.tsx
  main.tsx                # createRoot + StrictMode + useLang 装配（对照 panel/main.tsx）
  App.tsx                 # 布局骨架：Header（标题+明暗切换）/ Section 卡片列 / StatusToast
  styles.css              # @import tailwindcss + 共享令牌 partial（见下）
  settings-store.ts       # zustand：load(readSettings + retired-keys 清扫) / 草稿字段 / 字段级 persist(change 直写 / 防抖+失焦) / saving 反馈
  components/             # 表单原语：SectionCard / TextField / ToggleRow / Hint / StatusToast / SavedIndicator
  sections/               # 一 section 一组件（AGENTS.md 早已预告的目录，这次成真）
    AppearanceSection.tsx
    LlmSection.tsx
    TtsSection.tsx
    SuggestSection.tsx
    ComposerToolsSection.tsx
    QuickCommandsSection.tsx
    UsageSection.tsx
    DataSection.tsx
  lib/
    save.ts               # 保存纯函数：字段级 set/remove 决策（空 → remove）、防抖调度、retired-keys 清扫
    backup.ts             # 导入导出纯逻辑（现 reader 回调体）：redact/apply/密钥保护，IO 壳留组件
src/shared/
  tailwind-tokens.css     # 新：@theme inline 映射块从 panel/styles.css 抽出，两页 @import 同源
src/platform/  src/shared/ # 原样复用（settings/i18n/theme/format/tts-cache/usage-stats/download）
```

分层规则（dependency-cruiser 新增，模式照抄 panel）：`sections ← components ← settings-store/lib ← platform+shared`；禁止引 `src/panel/`（两页不共享组件层，共享的只有 shared/ 令牌与逻辑）。

### 样式与主题

- `themes.css` 仍是唯一色源，`theme-boot.js` 预绘不动，`data-theme-name`/`data-theme` 语义不变
- `@theme inline` 块（shadcn 语义色阶 ← 扩展令牌）抽到 `shared/tailwind-tokens.css`，`panel/styles.css` 与 `options/styles.css` 都 `@import`——**抽取是纯移动，panel 侧 diff 应为零行为变化**（radius 自引用陷阱的注释一并搬走）
- 597 行 `options.css` → Tailwind 语义类 + 少量组件级 CSS；`theme-card` 选择器组、折叠 `<details>` 样式按需重写

### 视觉与体验目标（不只是技术平移）

1. **保存反馈可见**：无保存按钮后，每个落盘动作给轻量确认——字段旁 ✓ 淡出（SavedIndicator）、开关切换即生效无需提示；写失败走 StatusToast——绝不静默丢改动
2. **密钥字段体验**：`type=password` 旁加可见性切换（眼睛图标）；`sk-` 前缀启发式与必填校验**内联到字段下方**（非阻断，见 §1.2）
3. **折叠区导航**：保持 `<details>` 折叠模式（Chrome 全屏打开，宽屏单列可滚动），但 summary 加 lucide 图标与当前区激活态；顶栏加锚点快跳
4. **语言切换即时生效**：React 重渲染天然解决（现在 `data-i18n` 重扫）
5. **快捷指令 CRUD**：受控表单 + 列表动画（Motion 可选，非必须）；空态引导
6. 一致性：与 panel 相同的语义令牌（bg-background/text-primary/border-border）、focus ring、表单间距节奏

## 3. 分阶段计划

### Phase 0 — 基建（半天）
- `shared/tailwind-tokens.css` 抽取 + `panel/styles.css` 改 import（验收：panel 构建产物视觉零变化）
- `index.html` 瘦身（#root + theme-boot + main.tsx 引用）；`options/styles.css`、`main.tsx`、空 `App.tsx`
- dependency-cruiser options 分层规则；RTL 复用 `tests/helpers/rtl-setup.ts`
- **旧 10 个 TS 模块原地保留**（不再被引用，测试继续绿）；manifest 不动
- 验收：`npm run build` 产出可加载的 React 空骨架页；lint/test/depcruise 全绿

### Phase 1 — 状态层 + 核心表单（1 天）
- `settings-store`：`load()` 用 `readSettings()`（默认值兜底，webSearch quirk 消亡）+ retired-keys 一次性清扫；字段级 persist（`lib/save.ts`：change 直写 / 防抖+失焦、空 → remove）
- 表单原语 `SectionCard/TextField/ToggleRow/Hint/StatusToast/SavedIndicator`
- `LlmSection` 全功能：provider 跟随 placeholder、apiKey 失焦落盘 + 内联校验（非阻断）、刷新模型（SW message + datalist + 失焦自动一次）
- 验收：store 单测覆盖 §1.2 语义逐条；LLM 区 RTL 测试（防抖落盘、清空 → remove、校验提示、刷新模型）；真实 Chromium 手测一轮

### Phase 2 — 其余 section（1–1.5 天）
- `AppearanceSection`（主题卡/明暗/语言 + `useLang()` 重渲染）
- `TtsSection`（凭据 + 即时开关 + 缓存量/清除）、`SuggestSection`、`ComposerToolsSection`
- `QuickCommandsSection`（受控 CRUD，重名/非法名校验平移）
- `UsageSection`（表格 + 区间 + 清空确认）
- `DataSection`（`lib/backup.ts`：导出脱敏/导入密钥保护，FileReader 壳在组件）
- `useLang()` hook：`setLanguage` 回调驱动 store 版本号，App 级重渲染
- 验收：`tests/options/` 五个文件对应的新测试全绿；**panel↔options 联动手测**（改主题/语言/composerTools，panel 不重载热生效）

### Phase 3 — 切换与收尾（半天）
- 删除旧模块：`index.ts` + 10 个 section TS + `options.css` + `tests/options/` 旧 DOM 测试（与转写同 commit 收口，不留红灯窗口）
- coverage 阈值校准；AGENTS.md 更新（Source Layout 的 options 行、Testing、components/ui 描述勘误）
- 全功能走查清单（见 §5）
- 验收：tsc/lint/depcruise/test/build 全绿；无死代码残留

## 4. 风险清单

| 风险 | 缓解 |
|---|---|
| 即时保存语义回归（哪个字段何时落盘、set 还是 remove） | §1.2 时序表是单一事实源；store 单测逐条冻结（含防抖/失焦路径） |
| secrets 导出脱敏 / 导入不清密钥被破环 | `tests/options/import-export.test.ts` 场景原样平移到 `lib/backup.ts` 测试 |
| 默认值路径（webSearch/composerTools 从未保存过） | `readSettings()` + SETTING_DEFAULTS；补"空存储加载"测试 |
| 语言切换不重渲染 | `useLang()` 订阅 `setLanguage` 回调；Phase 2 专项验证 |
| prompt guard（CJK 字面量禁令） | 新组件全走 `t()`（现 options 已是此模式）；CI 已有守卫 |
| MV3 CSP（禁内联脚本） | theme-boot.js 预绘保留；React 生产构建无 eval（panel 已验证） |
| 两页样式漂移 | 令牌 partial 共享同源；抽取 PR 独立先行评审 |
| 平移期测试红灯 | 旧模块与旧测试保留到 Phase 3 同步删除；每 Phase 结束全绿 |
| 覆盖率阈值 | options 计入全局阈值，转写不落后于删除；Phase 3 校准 |

## 5. 交付物清单

- [x] `docs/design/options-react-migration.md`（本文档，随实施更新状态）
- [x] `shared/tailwind-tokens.css` 抽取（panel 零行为变化——构建产物 CSS 逐字节一致）
- [x] `src/options/` React 应用 + `settings-store` / `lib/save.ts` / `lib/backup.ts`
- [x] sections RTL 测试 + store/纯函数单测（平移 `tests/options/` 全部场景：50 个新测试覆盖保存语义、secrets 导入导出、CRUD 校验、用量表、导入回读）
- [x] 手动走查清单：保存语义逐字段、secrets 导入导出、panel↔options 热生效联动（onSettingsChange 镜像 + 语言切换重渲染均有测试）、语言/主题切换、快捷指令 CRUD、用量表
- [x] AGENTS.md 更新（含 `components/ui/` 描述勘误）

## 附：决策记录补充

- **D-2 保存语义**（2026-11-24 拍板）：统一为**全部即时保存**——开关/下拉 change 即写，文本字段防抖 + 失焦落盘，保存按钮取消。原方案默认平移双轨的保守路线作废；随之消亡的还有 dirty 指示与 `beforeunload` 离开提醒（不再存在"未保存"状态）。跨页热生效（onSettingsChange）覆盖面从原来的即时字段子集扩大到全部字段。
