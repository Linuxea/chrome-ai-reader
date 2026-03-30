# Image Upload + OCR Design

## Context

Users need to extract text from images (screenshots, photos of documents, scanned PDFs) and feed the recognized content into the AI chat. This is the first iteration: add the upload UI, OCR processing, and in-memory result storage. OCR results are **not** appended to AI chat messages yet — that comes in a future iteration.

## Approach

Reuse the existing `quotePreview` visual pattern. Add an image upload button (paperclip icon) to the left of the textarea, and a horizontal thumbnail preview bar above the input wrapper. OCR runs immediately on upload via the existing `ocrParse` service worker handler.

## UI Changes

### Input area layout

```
┌──────────────────────────────────┐
│ quote preview bar (existing)     │  ← selected text preview
├──────────────────────────────────┤
│ [img1 ✓] [img2 ⏳] [img3 ×]     │  ← NEW: imagePreviewBar
├──────────────────────────────────┤
│ 📎 textarea              [send] │  ← NEW: 📎 upload button
└──────────────────────────────────┘
```

### HTML additions in side_panel.html

1. **Image preview bar** — above `input-wrapper`, below `quotePreview`:
```html
<div id="imagePreviewBar" class="image-preview-bar hidden"></div>
```

2. **Upload button + hidden file input** — inside `input-wrapper`, before textarea:
```html
<button id="imageUploadBtn" class="icon-btn upload-btn" title="上传图片">
  <svg><!-- paperclip icon --></svg>
</button>
<input type="file" id="imageFileInput" accept="image/*" multiple hidden>
```

### Thumbnail item structure (generated dynamically)

```html
<div class="image-preview-item" data-index="1">
  <img src="blob:..." class="image-thumb">
  <span class="image-status loading"></span>  <!-- or "done" / "error" -->
  <button class="image-remove" title="移除">×</button>
</div>
```

## State Management (in-memory only)

```javascript
let ocrResults = [];   // [{ index, fileName, text }]
let ocrRunning = 0;    // counter for in-progress OCR calls
```

## User Flows

### Upload + OCR flow

1. User clicks 📎 button → native file picker opens (accepts images, multiple)
2. For each selected file:
   a. Read as data URI via FileReader
   b. Create blob URL for thumbnail, append to `imagePreviewBar`
   c. Call `chrome.runtime.sendMessage({ action: 'ocrParse', file: dataUri })`
   d. Show loading spinner on thumbnail
   e. On success: update thumbnail to ✓, push `{ index, fileName, text }` to `ocrResults`
   f. On failure: update thumbnail to ✗ error state (image stays in bar, not added to ocrResults)
3. `imagePreviewBar` becomes visible, `imagePreviewBar.classList.remove('hidden')`

### Remove image

1. User clicks × on thumbnail → remove from DOM, remove from `ocrResults`
2. If bar is empty → hide it

### Send message

1. If `ocrRunning > 0` → show toast "OCR 识别中，请稍候", return
2. If any thumbnails show error state → show toast "部分图片 OCR 失败，请移除后重试", return
3. If `ocrResults.length > 0` → build `ocrContext` string:
   ```
   第1张图片的内容是：
   <text from ocrResults[0]>

   第2张图片的内容是：
   <text from ocrResults[1]>
   ```
3. **This iteration**: log `ocrContext` to console, do NOT append to AI message
4. Clear `imagePreviewBar`, reset `ocrResults = []`
5. Proceed with normal send flow

### Cancel on new chat

- Clicking "新建聊天" or starting a new conversation clears `ocrResults` and `imagePreviewBar`

## CSS

- `.image-preview-bar`: horizontal scroll container, same padding/bg as quote preview
- `.image-preview-item`: 56×56px thumbnail with rounded corners, position relative
- `.image-status`: absolute positioned badge (top-right corner), shows loading/done/error
- `.image-remove`: absolute positioned × button (top-left corner)
- `.upload-btn`: same styling as `.icon-btn`, paperclip SVG icon

## Files Modified

| File | Change |
|------|--------|
| `side_panel/side_panel.html` | Add `imagePreviewBar`, upload button, hidden file input |
| `side_panel/side_panel.css` | Add image preview bar and thumbnail styles |
| `side_panel/side_panel.js` | Add upload handler, OCR calling, state management, clear on send/new chat |
| `CLAUDE.md` | Document OCR results state and image upload flow |

## Out of Scope (future iterations)

- OCR results appended to AI chat context
- Drag-and-drop image upload
- Paste from clipboard
- Image preview in chat message bubbles
- Persistent OCR result storage
