# 图片粘贴与拖放功能设计

## 概述

为小🍐子阅读助手添加图片粘贴和拖放功能，让用户可以通过 Ctrl/Cmd+V 粘贴剪贴板图片，或直接拖放图片到侧边栏，替代现有的"点击附件按钮 → 选择文件"流程。

## 需求

- **粘贴功能**：在输入框聚焦时，Ctrl+V / Cmd+V 粘贴剪贴板中的图片
- **拖放功能**：可以拖放图片到侧边栏任意位置
- **内容类型**：仅支持 `image/*` 类型（PNG、JPG、GIF、WebP 等）
- **视觉反馈**：拖动图片进入侧边栏时，显示虚线边框 + 半透明遮罩 + 提示文字

## 文件结构

```
side_panel/
├── side_panel.html    # 添加 <script src="image-input.js">
├── side_panel.css     # 添加拖放高亮样式
├── side_panel.js      # 保持现有逻辑不变
├── image-input.js     # 【新增】粘贴 + 拖放事件处理
└── ... (其他现有文件)

i18n.js                # 添加 sidebar.dropHint 翻译
```

## 加载顺序

`image-input.js` 在 `side_panel.js` **之后**加载，确保可以调用全局函数 `addImagePreview()` 和 `runOCR()`。

```html
<script src="side_panel.js"></script>
<script src="image-input.js"></script>
```

## 实现细节

### 1. image-input.js 核心逻辑

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

### 2. CSS 拖放高亮样式

```css
/* side_panel.css - 添加到现有样式末尾 */

/* 拖放时的整体遮罩效果 */
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

/* 拖放时显示提示文字 */
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

**注意**：如果 `--primary-rgb` 变量不存在，需要在主题 CSS 中定义：
```css
:root {
  --primary: #8B5CF6;
  --primary-rgb: 139, 92, 246;
}
```

### 3. i18n 支持

```javascript
// i18n.js - TRANSLATIONS 对象中添加

// 中文
const TRANSLATIONS = {
  zh: {
    // ... 现有翻译
    'sidebar.dropHint': '松开以上传图片',
  },
  en: {
    // ... existing translations
    'sidebar.dropHint': 'Drop to upload image',
  }
};
```

### 4. HTML 修改

```html
<!-- side_panel.html - 在 side_panel.js 之后添加 -->
<script src="image-input.js"></script>
```

## 复用的现有函数

| 函数 | 来源 | 用途 |
|------|------|------|
| `imageIndex` | side_panel.js | 图片索引自增 |
| `addImagePreview(index, fileName, dataUri)` | side_panel.js | 添加图片预览到 UI |
| `runOCR(index, fileName, dataUri)` | side_panel.js | 调用 OCR API |
| `t(key)` | i18n.js | 国际化翻译 |

## 错误处理

- 粘贴非图片内容：不做任何处理，让浏览器默认行为生效
- 拖放非图片文件：静默忽略
- OCR 失败：复用现有逻辑，显示错误状态

## 测试要点

1. **粘贴测试**
   - 截图后粘贴 → 应添加到预览栏
   - 复制文件管理器中的图片文件后粘贴 → 应添加到预览栏
   - 粘贴纯文本 → 正常粘贴文本，不触发图片处理

2. **拖放测试**
   - 拖放单个图片 → 显示高亮，松开后添加到预览栏
   - 拖放多个图片 → 全部添加到预览栏
   - 拖放非图片文件 → 不处理
   - 拖放到侧边栏外部 → 取消，无效果

3. **视觉反馈测试**
   - 拖动进入时显示虚线边框 + 提示
   - 拖动离开或放下后恢复
   - 深色/浅色模式下样式正确

4. **国际化测试**
   - 切换语言后提示文字正确显示
