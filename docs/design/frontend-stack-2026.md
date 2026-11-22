# 前端技术方案（2026-11 侧边栏重写采用）

> 这套方案在 Chrome MV3 扩展侧边栏（窄面板、无 dev server、CSP 严格）里完整落地并经过三轮代码审查（24 个 bug 清零）。适用于任何 Vite + TS 项目；每一条都标注了实际踩过的坑。

## 1. 核心栈

| 层 | 选型 | 版本要点（坑） |
|---|---|---|
| UI 框架 | **React 19** | `jsx: "react-jsx"`；strict 模式全开 |
| 构建 | **Vite 6** + `@vitejs/plugin-react@^4` | ⚠️ plugin-react@**6 要求 Vite 8**，配 Vite 6 必须锁 `^4` |
| 样式 | **Tailwind CSS 4** + `@tailwindcss/vite` | CSS-first 配置（无 tailwind.config.js）；`@theme inline` 做令牌映射 |
| 状态 | **zustand** | v5；组件外可用（控制器层直接 `getState()`） |
| 动效 | **Motion**（`motion/react`，原 Framer Motion） | `MotionConfig reducedMotion="user"` 全局尊重系统设置 |
| 图标 | **lucide-react** | 按 size prop 内联，无字体图标 |
| 组件库 | **shadcn/ui 约定**（components.json 就绪） | 本次 UI 全部手写；CLI `add` 原语留给后续（弹层类） |
| 类型 | TypeScript 6 strict | ⚠️ `baseUrl` 已弃用，`paths` 可独立使用 |

## 2. 测试栈

| 工具 | 用途 | 坑 |
|---|---|---|
| Vitest 4 + jsdom | 全局 jsdom 环境 | — |
| @testing-library/react | 组件测试（renderHook / fireEvent / userEvent） | — |
| @testing-library/jest-dom | matcher 扩展 | ⚠️ jest-dom@**8 要 vitest 5**，配 vitest 4 锁 `^6` |
| setupFiles | `import '@testing-library/jest-dom/vitest'` 对旧测试惰性 | — |
| 自建 chrome mock | `vi.hoisted` 里建可编程端口（`_simulateMessage`） | **每个 connect 新建端口**——共享端口会把前一个测试的监听器漏进下一个（真实踩坑） |
| dependency-cruiser | 分层与环依赖强制 | 见 §4 |

## 3. 主题系统（多主题 × 明暗的推荐做法）

- **单一色彩源**：一份 `themes.css`，按 `[data-theme-name="x"][data-theme="dark"]` 组合选择器定义全部 CSS 变量；`<html>` 预绘脚本在 React 加载前设置属性（无 FOUC）
- **Tailwind 映射**：`@theme inline { --color-background: var(--bg); … }` —— 组件用 `bg-background` / `text-primary` 语义类，主题切换**零 React 参与**
- ⚠️ 坑：令牌名与 Tailwind 同名时（如 `--radius-lg`）**禁止** `--radius-lg: var(--radius-lg)`（自引用）；未层叠的 CSS 天然压过 Tailwind 的 `@layer theme`，同名即自动生效

## 4. 分层架构（depcruise 强制）

```
shared（纯数据/工具）← platform（chrome.* 包装）←
panel/
  state.ts     框架无关状态核心（持久化语义全在这，可独立测试）
  lib/         控制器（端口协议、发送管线、TTS/quiz/podcast 编排）+ 移植服务
  stores/      zustand（tabs/composer/stream/ui/…）
  hooks/       通用 DOM 行为 hook
  components/  chat / composer / panels / layout（components/ui = shadcn 原语，叶子）
  main.tsx→App 组合根（唯一允许挂 App）
```

## 5. 本次沉淀的关键模式

1. **状态核心 + 版本计数器**（tabs-store）：框架无关核心保留原地变异语义（服务层直接改对象 + 立即持久化），zustand 包装层每次变异 bump `version`，组件 `useActiveTabState()` 订阅 version 后重读。避免重写成熟的持久化语义。
2. **per-tab 键控 store**（stream/suggest/quiz/annotation）：`Record<tabId, State>`，跨 tab 资源（后台流式、后台完成的结局）天然存活。
3. **窗口全局资源注册点**（audio-resource.ts）：TTS/播客互斥用注册回调而非事件总线，避免 import 环。
4. **DOM 即状态 → store 派生**：预览图片、流式 live 气泡、retry 剪裁全部数据化；旧版 reattach/rerender 事件整体消亡。
5. **lib 控制器模式**：端口协议/编排与组件彻底分离，可在 vitest 里用端口 mock 直接驱动。
6. **git mv 搬迁**：可复用的旧模块原样搬（历史保留），只允许动的文件用 allowlist 钉死。

## 6. 踩坑清单（复用前必读）

| 坑 | 解法 |
|---|---|
| MV3 CSP 禁 eval/内联脚本 | 只用生产构建（`vite build --watch`），不起 dev server；React 19 生产无 eval |
| 侧边栏 100vh 幽灵滚动条 | `html/body/#root { height:100%; overflow:hidden }` + 唯一滚动容器 `min-height:0` |
| 流式 innerHTML 重建时滚动锚定抢 scrollTop | 滚动容器 `overflow-anchor: none` |
| `transform: scale()` 不改布局占位 | 缩放预览必须在包装器上**双轴**补偿 `width/height = 原尺寸 × k` |
| IME 输入法 Enter 误发 | `e.nativeEvent.isComposing || e.keyCode === 229` |
| 异步引擎连接顺序 ≠ 入队顺序 | 测试按端口**请求内容**匹配端口，不按连接序 |
| 后台 tab 完成的动作要落库 | 一切持久化 API 显式收 `tabId`，不用"当前 tab"隐式寻址 |
| i18n key 缺失裸奔 | CI 前跑一次 key 全量核对（grep 双向） |
| 时序敏感测试 flake | 事件链断言用 `vi.waitFor`（超时给足），稳态断言优先 |

## 7. 一键起步（新项目复制这份）

```bash
npm i react react-dom zustand motion lucide-react
npm i -D vite@^6 @vitejs/plugin-react@^4 tailwindcss @tailwindcss/vite \
  typescript @types/react @types/react-dom \
  vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom@^6 \
  dependency-cruiser
```

`vite.config.js`: `plugins: [react(), tailwindcss()]` + `resolve.alias['@']`；`tsconfig`: `jsx: react-jsx` + `paths`；`styles.css`: `@import "tailwindcss"` + `@theme inline` 令牌映射；分层规则照 §4 抄 `.dependency-cruiser.cjs`。
