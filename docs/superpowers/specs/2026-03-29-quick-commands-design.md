# 快捷指令功能设计

## 概述

在聊天框输入 `/` 弹出可筛选的快捷指令列表，选中后直接执行（提取页面内容 + 发送自定义 prompt）。用户可在设置页面管理快捷指令的增删改。

## 数据模型

- 存储 key: `chrome.storage.local` 中的 `quickCommands`（使用 local 而非 sync，因为用户 prompt 可能较长，sync 单 key 有 8KB 限制）
- 值: `[{ name: string, prompt: string }, ...]`
- 无指令时 key 不存在（删除最后一条指令时调用 `chrome.storage.local.remove('quickCommands')`）
- 不限制数量
- 约束：`name` 不能为空、不能包含 `/` 或空格、列表内唯一；`prompt` 不能为空

## 设置页面

在 `systemPrompt` 表单之后、保存按钮之前，新增"快捷指令"区块：

- 标题 + "+ 添加指令"按钮
- 列表：每行显示指令名（加粗）+ prompt 预览（截断 50 字）+ 编辑/删除按钮
- 点击"添加"或"编辑"：内联展开编辑表单（指令名输入框 + prompt textarea + 保存/取消）
- 删除：直接删除，无确认弹窗
- 变更实时保存到 storage，不走底部"保存设置"按钮（与页面上其他字段的"保存设置"行为不同，但快捷指令类似数据管理场景，实时保存更直观）

## 聊天框指令弹出

### 触发与筛选

- 输入框 input 事件检测 `/` 开头时弹出列表
- `/` 后的文字实时筛选（匹配指令名）
- 无匹配时显示"无匹配的快捷指令"

### 列表 UI

- 绝对定位浮层，紧贴输入框上方
- 每行: `/指令名` + prompt 预览（浅色截断）
- 最多显示 5 条，超出可滚动
- 第一条默认选中高亮

### 交互

键盘:
- `↑`/`↓` 切换选中项
- `Enter` 有匹配指令时执行选中指令；无匹配指令时作为正常消息发送
- `Esc` 关闭列表，保留输入框内容
- 其他字符继续筛选

鼠标:
- 点击指令 → 执行
- 点击列表外部 → 关闭

### 执行

选中指令 → 清空输入框 → 关闭列表 → 重置 `conversationHistory`（与现有快捷操作按钮行为一致）→ 提取页面内容 → 将用户的 prompt + 页面内容拼接后构建消息 → 调用 AI

**页面内容注入方式**：将页面内容（经 `safeTruncate` 截断）追加到用户 prompt 之后，格式为：

```
{用户的 prompt}

网页标题：{pageTitle}

网页内容如下：
{截断后的页面内容}
```

与现有 `getPromptTemplate` 模板结构一致。

### 数据同步

`side_panel.js` 通过 `chrome.storage.onChanged` 监听 `quickCommands` 变化，实时更新内存缓存（用户可能在设置页修改指令后返回聊天）。

## 变更范围

| 文件 | 变更 |
|------|------|
| `options.html` | 新增快捷指令区块 |
| `options.js` | CRUD 逻辑，实时保存到 `chrome.storage.local` |
| `options.css` | 列表和编辑表单样式 |
| `side_panel.js` | 加载指令（`chrome.storage.local`）、`/` 弹出列表、键盘/鼠标交互、执行指令、`onChanged` 监听 |
| `side_panel.css` | 弹出浮层样式 |

不涉及: `manifest.json`、`service_worker.js`、`content.js`。
