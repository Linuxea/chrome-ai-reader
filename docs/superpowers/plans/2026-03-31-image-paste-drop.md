# 图片粘贴与拖放功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为侧边栏添加图片粘贴和拖放功能，复用现有的 OCR 处理流程。

**Architecture:** 新建 `image-input.js` 模块处理 paste 和 drop 事件，调用 `side_panel.js` 中已有的 `addImagePreview()` 和 `runOCR()` 函数。通过 CSS 伪元素实现拖放视觉反馈。

**Tech Stack:** Vanilla JS, Chrome Extension Manifest V3, CSS Custom Properties

---

## 文件变更概览

| 文件 | 操作 | 说明 |
|------|------|------|
| `i18n.js` | 修改 | 添加 `sidebar.dropHint` 翻译 |
| `side_panel/side_panel.css` | 修改 | 添加 `--primary-rgb` 变量和拖放高亮样式 |
| `side_panel/image-input.js` | 创建 | 粘贴和拖放事件处理模块 |
| `side_panel/side_panel.html` | 修改 | 添加脚本引用 |

---

### Task 1: 添加 i18n 翻译

**Files:**
- Modify: `i18n.js:76` (zh), `i18n.js:228` (en)

- [ ] **Step 1: 添加中文翻译**

在 `i18n.js` 的 `zh` 对象中，在 `'sidebar.historyEmpty': '暂无历史对话',` 后面添加：

```javascript
'sidebar.dropHint': '松开以上传图片',
```

- [ ] **Step 2: 添加英文翻译**

在 `i18n.js` 的 `en` 对象中，在 `'sidebar.historyEmpty': 'No chat history',` 后面添加：

```javascript
'sidebar.dropHint': 'Drop to upload image',
```

- [ ] **Step 3: 验证修改**

Run: `grep -n "sidebar.dropHint" i18n.js`

Expected:
```
77:    'sidebar.dropHint': '松开以上传图片',
229:    'sidebar.dropHint': 'Drop to upload image',
```

- [ ] **Step 4: Commit**

```bash
git add i18n.js
git commit -m "feat(i18n): add sidebar.dropHint translation for drop hint"
```

---

### Task 2: 添加 CSS 变量和拖放样式

**Files:**
- Modify: `side_panel/side_panel.css:33` (sujian light), `side_panel/side_panel.css:58` (sujian dark), `side_panel/side_panel.css:84` (ocean light), `side_panel/side_panel.css:109` (ocean dark), `side_panel/side_panel.css:135` (forest light), `side_panel/side_panel.css:160` (forest dark)
- Modify: `side_panel/side_panel.css` (末尾添加拖放样式)

- [ ] **Step 1: 为素笺主题添加 --primary-rgb 变量**

在 `:root, [data-theme-name="sujian"]` 块中（约第10行），在 `--quote-bubble-text` 后添加：

```css
  --primary-rgb: 192, 120, 66;
```

在 `[data-theme-name="sujian"][data-theme="dark"]` 块中（约第35行），在 `--quote-bubble-text` 后添加：

```css
  --primary-rgb: 219, 160, 106;
```

- [ ] **Step 2: 为海洋主题添加 --primary-rgb 变量**

在 `[data-theme-name="ocean"]` 块中（约第61行），在 `--quote-bubble-text` 后添加：

```css
  --primary-rgb: 58, 123, 213;
```

在 `[data-theme-name="ocean"][data-theme="dark"]` 块中（约第86行），在 `--quote-bubble-text` 后添加：

```css
  --primary-rgb: 90, 156, 240;
```

- [ ] **Step 3: 为森林主题添加 --primary-rgb 变量**

在 `[data-theme-name="forest"]` 块中（约第112行），在 `--quote-bubble-text` 后添加：

```css
  --primary-rgb: 90, 138, 80;
```

在 `[data-theme-name="forest"][data-theme="dark"]` 块中（约第137行），在 `--quote-bubble-text` 后添加：

```css
  --primary-rgb: 125, 184, 122;
```

- [ ] **Step 4: 在文件末尾添加拖放高亮样式**

在 `side_panel.css` 文件末尾添加：

```css
/* ===== Drag & Drop Overlay ===== */

body.drag-over::before {
  content: '';
  position: fixed;
  inset: 0;
  background: rgba(var(--primary-rgb), 0.1);
  border: 2px dashed var(--primary);
  border-radius: 8px;
  pointer-events: none;
  z-index: 1000;
}

body.drag-over::after {
  content: attr(data-drop-hint);
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 12px 24px;
  background: var(--primary);
  color: white;
  border-radius: 8px;
  font-size: 14px;
  z-index: 1001;
  pointer-events: none;
}
```

- [ ] **Step 5: 验证修改**

Run: `grep -n "primary-rgb" side_panel/side_panel.css | head -10`

Expected: 应看到 6 个主题各有一行 `--primary-rgb` 定义

- [ ] **Step 6: Commit**

```bash
git add side_panel/side_panel.css
git commit -m "feat(css): add --primary-rgb variables and drag-drop overlay styles"
```

---

### Task 3: 创建 image-input.js 模块

**Files:**
- Create: `side_panel/image-input.js`

- [ ] **Step 1: 创建 image-input.js 文件**

在 `side_panel/` 目录下创建 `image-input.js`：

```javascript
// image-input.js — 图片粘贴与拖放处理

(function() {
  'use strict';

  // === DOM 引用 ===
  const userInput = document.getElementById('userInput');
  const imagePreviewBar = document.getElementById('imagePreviewBar');

  // === 初始化提示文字 ===
  document.body.dataset.dropHint = t('sidebar.dropHint');

  // === 粘贴事件 ===
  userInput.addEventListener('paste', handlePaste);

  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles = extractImageFilesFromItems(items);
    if (imageFiles.length > 0) {
      e.preventDefault();
      processImages(imageFiles);
    }
  }

  // === 拖放事件 ===
  document.body.addEventListener('dragover', handleDragOver);
  document.body.addEventListener('dragleave', handleDragLeave);
  document.body.addEventListener('drop', handleDrop);

  function handleDragOver(e) {
    e.preventDefault();
    if (hasImageFiles(e.dataTransfer)) {
      document.body.classList.add('drag-over');
    }
  }

  function handleDragLeave(e) {
    // 只有当离开整个文档时才移除高亮
    if (!e.relatedTarget || !document.body.contains(e.relatedTarget)) {
      document.body.classList.remove('drag-over');
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    document.body.classList.remove('drag-over');

    const imageFiles = extractImageFilesFromFileList(e.dataTransfer.files);
    if (imageFiles.length > 0) {
      processImages(imageFiles);
    }
  }

  // === 辅助函数 ===

  function extractImageFilesFromItems(items) {
    const files = [];
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    return files;
  }

  function extractImageFilesFromFileList(fileList) {
    const files = [];
    for (const file of fileList) {
      if (file.type.startsWith('image/')) {
        files.push(file);
      }
    }
    return files;
  }

  function hasImageFiles(dataTransfer) {
    if (dataTransfer.types.includes('Files')) {
      // 无法在 dragover 时检查具体文件类型，假设可能有图片
      return true;
    }
    return false;
  }

  function processImages(files) {
    if (files.length === 0) return;

    imagePreviewBar.classList.remove('hidden');

    files.forEach(file => {
      // 复用 side_panel.js 中的全局变量和函数
      imageIndex++;
      const idx = imageIndex;

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUri = e.target.result;
        addImagePreview(idx, file.name, dataUri);
        runOCR(idx, file.name, dataUri);
      };
      reader.readAsDataURL(file);
    });
  }
})();
```

- [ ] **Step 2: 验证文件创建**

Run: `wc -l side_panel/image-input.js`

Expected: 约 95 行

- [ ] **Step 3: Commit**

```bash
git add side_panel/image-input.js
git commit -m "feat(input): add image-input.js for paste and drop handling"
```

---

### Task 4: 修改 HTML 添加脚本引用

**Files:**
- Modify: `side_panel/side_panel.html:137`

- [ ] **Step 1: 添加脚本引用**

在 `side_panel/side_panel.html` 中，找到：
```html
<script src="side_panel.js"></script>
```

在其后添加：
```html
<script src="image-input.js"></script>
```

最终 script 部分应为：
```html
<script src="../i18n.js"></script>
<script src="../libs/marked.min.js"></script>
<script src="chat-history.js"></script>
<script src="quick-commands.js"></script>
<script src="ui-helpers.js"></script>
<script src="tts-streaming.js"></script>
<script src="side_panel.js"></script>
<script src="image-input.js"></script>
```

- [ ] **Step 2: 验证修改**

Run: `grep -n "image-input.js" side_panel/side_panel.html`

Expected:
```
138:  <script src="image-input.js"></script>
```

- [ ] **Step 3: Commit**

```bash
git add side_panel/side_panel.html
git commit -m "feat(html): load image-input.js in side panel"
```

---

### Task 5: 手动测试

**Files:**
- Test: Chrome Extension

- [ ] **Step 1: 重新加载扩展**

1. 打开 `chrome://extensions/`
2. 点击扩展卡片上的刷新按钮

- [ ] **Step 2: 测试粘贴功能**

1. 截图或复制一张图片到剪贴板
2. 在侧边栏输入框中按 Ctrl+V / Cmd+V
3. 验证：图片应出现在预览栏，OCR 状态显示加载中

- [ ] **Step 3: 测试拖放功能**

1. 从文件管理器拖动一张图片到侧边栏
2. 验证：拖动时显示虚线边框 + 提示文字
3. 松开后图片应添加到预览栏

- [ ] **Step 4: 测试边界情况**

1. 粘贴纯文本 → 应正常粘贴文本
2. 拖放非图片文件 → 应无反应
3. 切换深色/浅色模式 → 拖放高亮样式应正确显示
4. 切换语言 → 提示文字应正确切换

- [ ] **Step 5: 最终 Commit（如有修复）**

```bash
git add -A
git commit -m "fix: address testing issues"
```

---

## 测试清单

| 场景 | 预期结果 |
|------|----------|
| 截图后粘贴 | 图片添加到预览栏，触发 OCR |
| 从文件管理器复制图片后粘贴 | 图片添加到预览栏，触发 OCR |
| 粘贴纯文本 | 正常粘贴文本内容 |
| 拖动图片进入侧边栏 | 显示虚线边框 + 提示文字 |
| 拖放图片到侧边栏 | 图片添加到预览栏，触发 OCR |
| 拖放非图片文件 | 无反应 |
| 深色模式拖放高亮 | 虚线边框和提示文字颜色正确 |
| 切换语言后拖放 | 提示文字使用对应语言 |
