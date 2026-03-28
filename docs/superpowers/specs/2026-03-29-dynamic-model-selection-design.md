# 动态模型选择

## 背景

当前 `service_worker.js` 中模型名称硬编码为 `deepseek-chat`，用户无法切换模型。切换不同 OpenAI 兼容 API 提供商时，也无法选择该提供商特有的模型。

## 目标

- 移除硬编码模型名称
- 利用 OpenAI 兼容的 `GET /models` 接口动态获取可用模型列表
- 用户在设置页选择模型，同时支持手动输入
- 侧边栏底部状态栏显示当前使用的模型

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 模型选择器位置 | 设置页（options） | 模型切换是低频操作，与 API Key/API 地址属于同类配置 |
| 获取模型列表时机 | 打开设置页时自动获取 + 手动刷新按钮 | 大多数情况打开即可见，换过配置后可手动刷新 |
| 列表获取失败时的回退 | 组合框：下拉选择 + 手动输入 | 即使列表接口不可用或新模型不在列表中，用户也不被卡住 |
| UI 组件 | `<input>` + `<datalist>` | 原生 HTML5 组件，零额外 CSS/JS，匹配项目简洁风格 |
| 当前模型显示位置 | 侧边栏底部状态栏 | 不占用聊天/输入区域，低调可辨识 |
| 模型列表获取方式 | 通过 service_worker.js 中转 | options 页面直接 fetch 可能有 CORS 限制；service worker 拥有更广泛的网络访问权限 |

## API 路径约定

现有代码中，聊天接口路径为 `${baseUrl}/chat/completions`（见 `service_worker.js:20`），即 `baseUrl` 不包含 `/v1` 前缀。模型列表接口保持一致：`${baseUrl}/models`。

## 数据流

```
设置页 options.js（获取模型列表）
  → chrome.runtime.sendMessage({ action: 'fetchModels', apiBase, apiKey })
  → service_worker.js 收到 → fetch GET {apiBase}/models
  → 返回模型列表 → options.js 填充 datalist

设置页 options.js（保存模型）
  → chrome.storage.sync.set({ modelName: 'xxx' })
  → 空值时 chrome.storage.sync.remove('modelName')

service_worker.js 调用 AI 时
  → chrome.storage.sync.get('modelName')
  → model: modelName || 'deepseek-chat'  // 向后兼容

side_panel.js 状态栏
  → chrome.storage.sync.get('modelName') → 显示
  → chrome.storage.onChanged → 实时更新
```

## 涉及文件

### 1. `options/options.html` — 新增模型选择 UI

在 API 地址和 System Prompt 之间新增表单组：
- `<input list="model-list" id="modelName">` + `<datalist id="model-list">`
- 刷新按钮"刷新模型列表"
- 占位符：`点击刷新按钮获取可用模型，或手动输入模型名称`
- 提示文字：`选择或输入要使用的模型名称。点击刷新按钮从当前 API 地址获取可用模型列表。`

### 2. `options/options.css` — 模型选择区样式

- 刷新按钮样式（复用 `.save-btn` 的基础样式，调整为小按钮）
- input + button 的行内布局

### 3. `options/options.js` — 模型获取与保存

- **页面加载**：从 `chrome.storage.sync` 读取 `modelName` 填入输入框
- **刷新按钮**：
  - 从**表单输入框**读取 `apiBase`（而非 storage，因为用户可能改了但未保存）和 `apiKey`
  - 通过 `chrome.runtime.sendMessage({ action: 'fetchModels', apiBase, apiKey })` 发送给 service worker 中转请求（避免 options 页面的 CORS 限制）
  - 请求期间按钮禁用，文字变为"加载中..."
  - 成功：解析响应中 `data[].id` 填充 `<datalist>` 的 `<option value="model-id">`
  - 失败：清空 datalist，显示错误提示，输入框仍可手动输入
- **自动获取**：页面加载时如果有 `apiKey`，自动触发一次刷新
- **保存**：
  - `modelName` 非空时写入 `chrome.storage.sync`
  - `modelName` 为空时调用 `chrome.storage.sync.remove('modelName')`（匹配现有 `apiBase`/`systemPrompt` 的处理模式）

### 4. `service_worker.js` — 新增模型列表中转 + 读取模型名称

- **新增消息监听**：处理 `{ action: 'fetchModels', apiBase, apiKey }` 消息
  - 构造 `GET {apiBase}/models` 请求，附带 `Authorization: Bearer {apiKey}` 头
  - 返回 `{ success: true, models: [...] }` 或 `{ success: false, error: '...' }`
- **callOpenAI 改动**：从 `chrome.storage.sync` 读取 `modelName`
  - `model: modelName || 'deepseek-chat'`（向后兼容）

### 5. `side_panel/side_panel.html` — 底部状态栏

- 在 `.input-area` 内部底部新增状态栏元素，显示 `当前模型：{modelName}`
- 位于输入框区域的下方，作为 `.input-area` 的一部分

### 6. `side_panel/side_panel.js` — 显示模型名称

- 页面加载时读取 `modelName`，无值或空值显示默认 `deepseek-chat`
- 监听 `chrome.storage.onChanged`，`modelName` 变化时（包括被 remove）实时更新状态栏

### 7. `side_panel/side_panel.css` — 状态栏样式

- 小字体（如 12px）、灰色文字（如 `var(--text-tertiary)` 或 `#999`）
- 文字居中，适当内边距
- 位于 `.input-area` 底部

## 存储变更

新增 `chrome.storage.sync` 字段：
- `modelName`（string）— 用户选择的模型名称，可选，无值时回退到 `deepseek-chat`
- 空值时不存储（使用 `remove` 清除），与现有 `apiBase`/`systemPrompt` 模式一致

## 已知限制

- `<datalist>` 在模型列表很长时没有分页/滚动能力，用户需通过输入过滤。对于大多数提供商（DeepSeek、硅基流动等），模型数量在几十个以内，可接受
- 不对模型列表做排序或截断，直接展示 API 返回的全部模型
