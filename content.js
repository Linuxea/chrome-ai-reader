// content.js — 页面内容提取
// 使用 Mozilla Readability 提取当前页面正文

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extract') {
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
        error: '页面内容提取失败: ' + e.message
      });
    }
    return true; // 异步 sendResponse
  }
});
