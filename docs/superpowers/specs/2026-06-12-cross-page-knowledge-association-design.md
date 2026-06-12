# 跨页面知识关联 — 设计文档

> 日期: 2026-06-12 | 状态: 待评审

## 概述

用户阅读网页后，系统自动提取页面摘要并生成 embedding 向量，与历史页面计算余弦相似度，下次打开侧边栏时展示"相关阅读"面板，帮助用户发现不同页面之间的主题关联。

## 核心流程

```
用户打开页面 → 提取内容摘要 → 调用 embedding API 生成向量 → 存本地
                                                          ↓
                                                后台计算余弦相似度
                                                          ↓
                                          找到 top-5 相关历史页面
                                                          ↓
                                      下次打开侧边栏时展示"相关阅读"
```

## 新增/修改文件

| 文件 | 变更 |
|------|------|
| `src/background/sw-openai.ts` | 新增 `callEmbedding()` 函数 |
| `src/background/service-worker.ts` | 新增 `embedding` 端口处理 |
| `src/shared/types.ts` | 新增 `PageRecord`、`PageRelation` 类型 |
| `src/side_panel/services/page-extractor.ts` | 提取后触发 embedding 流程 |
| `src/side_panel/features/related-pages.ts` | **新文件** — 关联页面核心逻辑 + UI |
| `src/side_panel/main.ts` | 初始化 related-pages 模块 |
| `src/side_panel/events.ts` | 新增 `SHOW_RELATED_PAGES` 事件 |
| `src/options/` | 新增 embedding 配置区域（独立 section） |
| `src/shared/i18n.js` | 新增知识关联相关文案 |
| `tests/side_panel/features/related-pages.test.js` | **新文件** — 单元测试 |
| `tests/background/sw-openai.test.js` | 扩展 — embedding API 测试 |

## 存储结构

`chrome.storage.local` key: `pageRecords`

```typescript
interface PageRecord {
  id: string;           // 唯一 ID (crypto.randomUUID)
  url: string;          // 页面 URL
  title: string;        // 页面标题
  excerpt: string;      // 页面摘要（用于展示，最多 200 字）
  embedding: number[];  // 向量（维度取决于模型）
  timestamp: number;    // 阅读时间 (Date.now())
}
```

- 每条记录约 8KB（假设 1536 维 float32）
- 默认上限 200 条，约 1.6MB（chrome.storage.local 限制 10MB，安全）
- 同一 URL 重复访问时覆盖已有记录

## API 调用

**Endpoint:** `POST {apiBase}/embeddings`

**请求体:**
```json
{
  "model": "doubao-embedding-vision",
  "input": "页面摘要文本"
}
```

**响应体 (OpenAI 兼容格式):**
```json
{
  "data": [{ "embedding": [0.123, -0.456, ...] }]
}
```

## 默认配置

| 配置项 | 默认值 | 存储 key |
|--------|--------|----------|
| embedding API Key | `ark-c560a184-7bc3-455c-ba38-4047d8cbe20e-e91e3` | `embeddingApiKey` |
| embedding API Base | `https://ark.cn-beijing.volces.com/api/coding/v3` | `embeddingApiBase` |
| embedding 模型 | `doubao-embedding-vision` | `embeddingModel` |
| 相似度阈值 | 70% | `embeddingThreshold` |
| 最大存储页数 | 200 | `embeddingMaxPages` |
| 启用知识关联 | true | `embeddingEnabled` |

**Fallback 规则:**
- `embeddingApiKey` 为空时回退到主 `apiKey`
- `embeddingApiBase` 为空时回退到主 `apiBase`
- 注意：豆包 embedding base URL 末尾是 `/v3`，与主 LLM 的 `/v1` 约定不同，需独立处理

## UI 设计

### 侧边栏 "相关阅读" 面板

位于聊天区域下方，可折叠：

```
┌─────────────────────────────┐
│ 📚 相关阅读 (3)    ▲ 收起    │
├─────────────────────────────┤
│ 📄 如何优化 React 性能        │
│    相似度 92% · 2天前        │
│    "讨论了 memo/useMemo/     │
│     useCallback 的使用..."   │
├─────────────────────────────┤
│ 📄 Vue3 响应式原理深入         │
│    相似度 87% · 5天前        │
│    "从 Object.defineProperty │
│     到 Proxy 的演进..."      │
├─────────────────────────────┤
│ 📄 前端框架对比 2024          │
│    相似度 81% · 1周前        │
│    "React vs Vue vs Svelte  │
│     生态与性能对比..."       │
└─────────────────────────────┘
```

**交互规则:**
- 面板默认折叠，有新关联发现时显示红点 badge
- 点击条目 → `chrome.tabs.create({ url })` 新标签页打开
- 相似度 < 阈值的不展示
- 最多展示 5 条
- 支持一键清除所有记录（确认弹窗）

### 设置页 "知识关联" 区域

| 配置项 | 控件类型 | 默认值 |
|--------|----------|--------|
| 启用知识关联 | toggle | 开 |
| embedding API Key | password input | 预设值 |
| embedding API Base | text input | 预设值 |
| embedding 模型 | text input | `doubao-embedding-vision` |
| 相似度阈值 | range slider | 70% (50%-95%) |
| 最大存储页数 | number input | 200 |
| 清除所有记录 | button | — |

## 错误处理 & 边界情况

### API 调用失败
- embedding API 不可用时静默跳过，不阻塞正常阅读流程
- 设置页显示状态指示（绿色=正常，黄色=失败，灰色=未启用）
- 连续失败 3 次后自动暂停 1 小时（`chrome.alarms` 或时间戳判断）

### 向量存储管理
- 超过最大页数时 FIFO 清理最旧记录
- 同一 URL 重复访问时更新已有记录（覆盖 embedding + timestamp + excerpt）
- 清除浏览器数据时一并清除（`chrome.storage.local` 由浏览器管理）

### 性能
- embedding 计算在 service worker 后台进行，不阻塞 UI
- 相似度计算：余弦相似度 = dot(A,B) / (|A| × |B|)，200 条全量比对 < 5ms
- 页面关闭后延迟 3 秒再触发 embedding（避免快速切换标签页浪费调用）

### 隐私
- 所有数据仅存本地 `chrome.storage.local`，不上传任何第三方
- 摘要文本仅用于生成 embedding，不存储原始页面内容

### 降级策略
- 页面内容 < 100 字符时跳过（无意义页面如登录页、404）
- embedding 返回空向量时跳过
- 用户关闭"启用知识关联"开关后停止所有 embedding 调用，保留已有数据

## 测试策略

### 单元测试 (`tests/side_panel/features/related-pages.test.js`)

| 场景 | 预期 |
|------|------|
| 余弦相似度 — 相同向量 | 1.0 |
| 余弦相似度 — 正交向量 | 0.0 |
| 余弦相似度 — 典型向量 | ~0.85 |
| 相似度过滤 | 低于阈值的记录被排除 |
| Top-N 排序 | 按相似度降序，最多 5 条 |
| 重复 URL 更新 | 同 URL 再次访问时覆盖旧记录 |
| FIFO 清理 | 超出最大页数时删除最旧记录 |
| 短内容跳过 | < 100 字符的页面不触发 embedding |
| 空向量跳过 | embedding 返回空数组时静默跳过 |
| 开关关闭 | 禁用时不发起 embedding 请求 |

### 集成测试 (`tests/background/sw-openai.test.js` 扩展)

| 场景 | 预期 |
|------|------|
| embedding API 调用 | 正确组装请求体、解析响应向量 |
| API Key fallback | embedding key 为空时回退到主 key |
| API Base fallback | embedding base 为空时回退到主 base |
| 连续失败暂停 | 3 次失败后标记暂停 |

### 不测试
- chrome.storage.local 读写（chrome-mock 已有覆盖）
- UI 渲染细节（dom-helpers 已有 98% 覆盖率，新面板复用现有模式）
