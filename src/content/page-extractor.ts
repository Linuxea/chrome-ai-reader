import { Readability } from '@mozilla/readability';
import { paragraphsFromHtml, extractParagraphs } from './paragraphs';
import { youtubeVideoId } from '../shared/youtube';
import { fetchYouTubeTranscript, videoDescription } from './youtube';

interface ExtractData {
  title: string;
  textContent: string;
  excerpt: string;
  content: string;
  byline: string;
  siteName: string;
  /** Article paragraphs (labelled [#N] in prompts; citations point back to them). */
  paragraphs: string[];
  /** 'video' when the text is a YouTube transcript (F3). */
  kind?: 'article' | 'video';
}

type Respond = (response: { success: boolean; data?: ExtractData; error?: string }) => void;

function extractArticle(): ExtractData {
  const documentClone = document.cloneNode(true) as Document;
  const article = new Readability(documentClone).parse();
  if (article) {
    return {
      title: article.title || document.title || '',
      textContent: article.textContent || '',
      excerpt: article.excerpt || '',
      content: article.content || '',
      byline: article.byline || '',
      siteName: article.siteName || '',
      paragraphs: paragraphsFromHtml(article.content || ''),
    };
  }
  return {
    title: document.title || '',
    textContent: document.body?.innerText || '',
    excerpt: '',
    content: '',
    byline: '',
    siteName: '',
    paragraphs: document.body ? extractParagraphs(document.body) : [],
  };
}

/**
 * F3: on a YouTube video the transcript is the "article" (the watch page
 * itself is mostly UI). The description rides along as the first paragraph.
 * No transcript → the normal extraction.
 */
async function extractVideo(): Promise<ExtractData | null> {
  const transcript = await fetchYouTubeTranscript();
  if (!transcript) return null;
  const title = document.title.replace(/ - YouTube$/, '');
  const description = videoDescription();
  const paragraphs = description ? [description, ...transcript.paragraphs] : transcript.paragraphs;
  return {
    title,
    textContent: paragraphs.join('\n\n'),
    excerpt: (description || transcript.paragraphs[0] || '').slice(0, 200),
    content: '',
    byline: '',
    siteName: 'YouTube',
    paragraphs,
    kind: 'video',
  };
}

const fail = (e: unknown) => ({ success: false, error: 'Failed to extract page content: ' + (e as Error).message });

export function handleExtract(_msg: unknown, sendResponse: Respond): true {
  if (youtubeVideoId(location.href)) {
    extractVideo()
      .then((video) => sendResponse({ success: true, data: video ?? extractArticle() }))
      .catch((e: unknown) => sendResponse(fail(e)));
    return true;
  }
  try {
    sendResponse({ success: true, data: extractArticle() });
  } catch (e: unknown) {
    sendResponse(fail(e));
  }
  return true;
}
