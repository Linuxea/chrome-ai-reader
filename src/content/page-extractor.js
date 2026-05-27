// page-extractor.js — 使用 Readability 提取页面正文
import { Readability } from '@mozilla/readability';

export function handleExtract(_msg, sendResponse) {
  try {
    const documentClone = document.cloneNode(true);
    const reader = new Readability(documentClone);
    const article = reader.parse();

    if (article) {
      sendResponse({
        success: true,
        data: {
          title: article.title || document.title || '',
          textContent: article.textContent || '',
          excerpt: article.excerpt || '',
          content: article.content || '',
          byline: article.byline || '',
          siteName: article.siteName || ''
        }
      });
    } else {
      // Readability 解析失败时回退到 body 文本
      sendResponse({
        success: true,
        data: {
          title: document.title || '',
          textContent: document.body.innerText || '',
          excerpt: '',
          content: '',
          byline: '',
          siteName: ''
        }
      });
    }
  } catch (e) {
    sendResponse({
      success: false,
      error: 'Failed to extract page content: ' + e.message
    });
  }
  return true;
}
