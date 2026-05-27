import { Readability } from '@mozilla/readability';

interface ExtractData {
  title: string;
  textContent: string;
  excerpt: string;
  content: string;
  byline: string;
  siteName: string;
}

export function handleExtract(_msg: unknown, sendResponse: (response: { success: boolean; data?: ExtractData; error?: string }) => void): true {
  try {
    const documentClone = document.cloneNode(true) as Document;
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
          siteName: article.siteName || '',
        },
      });
    } else {
      sendResponse({
        success: true,
        data: {
          title: document.title || '',
          textContent: document.body?.innerText || '',
          excerpt: '',
          content: '',
          byline: '',
          siteName: '',
        },
      });
    }
  } catch (e: unknown) {
    sendResponse({
      success: false,
      error: 'Failed to extract page content: ' + (e as Error).message,
    });
  }
  return true;
}
