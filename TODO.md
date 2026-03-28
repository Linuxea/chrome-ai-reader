# AI 阅读助手 — 功能清单

## 已实现

### 核心功能
- [x] 页面内容提取 — Readability.js 提取正文，失败时回退到 `body.innerText`
- [x] 总结页面 — 一键生成页面摘要（3-5 个要点）
- [x] 翻译页面 — 将页面内容翻译为中文
- [x] 提取关键信息 — 列出重要事实、数据、观点
- [x] 自由问答 — 基于页面内容的对话式问答
- [x] 流式输出 — SSE 逐字显示 AI 回复
- [x] Markdown 渲染 — marked.js 渲染 AI 回复

### 设置与配置
- [x] API Key 配置 — options 页保存到 `chrome.storage.sync`
- [x] 自定义 API 地址 — 支持 OpenAI 兼容接口（默认 DeepSeek）
- [x] Key 输入遮盖 — `type="password"` 安全处理
- [x] 自定义 System Prompt — 追加到默认 prompt 之后，个性化 AI 回答风格

### UI 交互
- [x] 侧边栏 UI — Chrome Side Panel 面板
- [x] 快捷操作按钮 — 总结 / 翻译 / 关键信息
- [x] 对话气泡 — 用户消息与 AI 回复区分显示
- [x] 输入框自动调整高度
- [x] Enter 发送 / Shift+Enter 换行
- [x] 生成中禁用按钮（防重复提交）
- [x] Typing 加载指示器
- [x] 自动滚动到底部
- [x] 欢迎引导提示
- [x] 错误提示（无 API Key、API 错误、页面提取失败）
- [x] 新建聊天 — 清空会话历史，重新开始对话
- [x] 历史对话持久化 — chrome.storage.local 保存/加载/删除，最多保留 50 条
- [x] 导出聊天记录 — 当前对话和历史记录均可导出为 Markdown 文件

### 基础设施
- [x] Manifest V3 配置
- [x] Content Script 自动注入
- [x] Service Worker 后台服务
- [x] 长连接通信（`chrome.runtime.connect`）
- [x] 内容长度截断 — safeTruncate 统一 ~32000 字符，在段落/句子边界断开

---

## 待实现

<!-- 在下方添加你计划实现的功能 -->

---

## 已实现（v1.1）

### 选中文本引用
- [x] 实时选区检测 — content.js 监听 selectionchange，300ms 防抖推送
- [x] 引用预览条 — 输入框上方显示选中文本前 50 字预览，可手动清除
- [x] 引用集成 prompt — 自由问答时引用内容作为虚拟 user/assistant 对发给 AI
- [x] 聊天气泡引用预览 — 用户消息中显示引用 blockquote
- [x] 快捷操作不受影响 — 总结/翻译/关键信息仍只用完整页面内容
