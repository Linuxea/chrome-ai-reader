// tts/utils.js — Markdown cleanup and text segmentation for TTS

/**
 * 简单清理 Markdown 语法，返回纯文本供 TTS 使用
 */
export function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')           // 代码块
    .replace(/`([^`]+)`/g, '$1')               // 行内代码
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // 链接 → 保留文本
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')  // 图片 → 保留 alt
    .replace(/#{1,6}\s+/g, '')                  // 标题
    .replace(/\*\*([^*]+)\*\*/g, '$1')          // 粗体
    .replace(/\*([^*]+)\*/g, '$1')              // 斜体
    .replace(/__([^_]+)__/g, '$1')              // 粗体下划线
    .replace(/_([^_]+)_/g, '$1')               // 斜体下划线
    .replace(/~~([^~]+)~~/g, '$1')              // 删除线
    .replace(/^[-*+]\s+/gm, '')                 // 无序列表标记
    .replace(/^\d+\.\s+/gm, '')                 // 有序列表标记
    .replace(/^>\s+/gm, '')                     // 引用标记
    .trim();
}

export const SENTENCE_ENDS = '。！？.!?';

/**
 * 将完整文本按句末标点切分为段（每 5 个句末标点一段）
 */
export function splitToSegments(text) {
  const segments = [];
  let count = 0;
  let lastCut = 0;

  for (let i = 0; i < text.length; i++) {
    if (SENTENCE_ENDS.includes(text[i])) {
      count++;
      if (count >= 5) {
        segments.push(text.slice(lastCut, i + 1).trim());
        lastCut = i + 1;
        count = 0;
      }
    }
  }

  // 剩余文本
  const remaining = text.slice(lastCut).trim();
  if (remaining) {
    segments.push(remaining);
  }

  return segments.filter(s => s.length > 0);
}
