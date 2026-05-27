import { t } from '../../shared/i18n.js';
import { TRUNCATE_LIMITS, safeTruncate, escapeHtml } from '../../shared/constants';
import { stripMarkdownFence } from '../../shared/json-repair';
import { downloadFile } from '../../shared/download';
import { marked } from 'marked';
import * as state from '../state';
import { emit, EVENTS } from '../events';
import { appendMessage, scrollToBottom, setButtonsDisabled } from '../ui/dom-helpers';
import { stopTTS } from '../services/tts/index.js';

let _extractPageContent: () => Promise<{ textContent: string }>;

export function initOutline(deps: { onExtractPageContent: () => Promise<{ textContent: string }> }): void {
  _extractPageContent = deps.onExtractPageContent;
}

interface OutlineSection {
  heading: string;
  summary?: string;
  data?: string[];
  quote?: string;
  children?: OutlineSection[];
}

interface OutlineData {
  title: string;
  sections: OutlineSection[];
}

export function parseOutlineResponse(rawText: string | null): OutlineData | null {
  if (!rawText) return null;

  try {
    const data = JSON.parse(rawText) as OutlineData;
    if (data && data.title && data.sections) return data;
  } catch { /* not direct JSON */ }

  try {
    const trimmed = stripMarkdownFence(rawText);
    const data = JSON.parse(trimmed) as OutlineData;
    if (data && data.title && data.sections) return data;
  } catch { /* not valid outline JSON */ }

  return null;
}

export function outlineToMarkdown(data: OutlineData | null): string {
  if (!data) return '';
  let md = '# ' + data.title + '\n\n';
  if (data.sections && data.sections.length > 0) {
    data.sections.forEach(section => {
      md += sectionToMarkdown(section, 2);
    });
  }
  return md.trim();
}

export function sectionToMarkdown(section: OutlineSection, level: number): string {
  let prefix = '';
  for (let i = 0; i < level; i++) prefix += '#';
  let md = prefix + ' ' + section.heading + '\n\n';

  if (section.summary) md += section.summary + '\n\n';

  if (section.data && section.data.length > 0) {
    section.data.forEach(item => { md += '- ' + item + '\n'; });
    md += '\n';
  }

  if (section.quote) md += '> ' + section.quote.replace(/\n/g, '\n> ') + '\n\n';

  if (section.children && section.children.length > 0) {
    section.children.forEach(child => { md += sectionToMarkdown(child, level + 1); });
  }

  return md;
}

function renderOutlineNode(section: OutlineSection): HTMLDivElement {
  const node = document.createElement('div');
  node.className = 'outline-node';

  const heading = document.createElement('div');
  heading.className = 'outline-heading';

  const arrow = document.createElement('span');
  arrow.className = 'outline-arrow';
  arrow.textContent = '\u25B6';

  const headingText = document.createElement('span');
  headingText.className = 'outline-heading-text';
  headingText.textContent = section.heading;

  heading.appendChild(arrow);
  heading.appendChild(headingText);
  heading.addEventListener('click', () => { node.classList.toggle('expanded'); });
  node.appendChild(heading);

  const card = document.createElement('div');
  card.className = 'outline-card';

  if (section.summary) {
    const s = document.createElement('div'); s.className = 'outline-card-section';
    const l = document.createElement('div'); l.className = 'outline-card-label'; l.textContent = t('outline.label.summary');
    const txt = document.createElement('div'); txt.className = 'outline-card-summary'; txt.textContent = section.summary;
    s.appendChild(l); s.appendChild(txt); card.appendChild(s);
  }

  if (section.data && section.data.length > 0) {
    const s = document.createElement('div'); s.className = 'outline-card-section';
    const l = document.createElement('div'); l.className = 'outline-card-label'; l.textContent = t('outline.label.data');
    const list = document.createElement('ul'); list.className = 'outline-card-data';
    section.data.forEach(item => { const li = document.createElement('li'); li.textContent = item; list.appendChild(li); });
    s.appendChild(l); s.appendChild(list); card.appendChild(s);
  }

  if (section.quote) {
    const s = document.createElement('div'); s.className = 'outline-card-section';
    const l = document.createElement('div'); l.className = 'outline-card-label'; l.textContent = t('outline.label.quote');
    const bq = document.createElement('blockquote'); bq.className = 'outline-card-quote'; bq.textContent = section.quote;
    s.appendChild(l); s.appendChild(bq); card.appendChild(s);
  }

  node.appendChild(card);

  if (section.children && section.children.length > 0) {
    const cc = document.createElement('div'); cc.className = 'outline-children';
    section.children.forEach(child => { cc.appendChild(renderOutlineNode(child)); });
    node.appendChild(cc);
  }

  return node;
}

function renderOutline(data: OutlineData): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'outline-container';

  const header = document.createElement('div'); header.className = 'outline-header';
  const titleSpan = document.createElement('span'); titleSpan.className = 'outline-title-text';
  titleSpan.textContent = t('outline.title') + ' ' + data.title;
  header.appendChild(titleSpan);
  container.appendChild(header);

  if (data.sections) data.sections.forEach(s => container.appendChild(renderOutlineNode(s)));

  const footer = document.createElement('div'); footer.className = 'outline-footer';

  const copyBtn = document.createElement('button'); copyBtn.className = 'outline-action-btn'; copyBtn.textContent = t('outline.copy');
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(outlineToMarkdown(data)).then(() => {
      copyBtn.textContent = t('outline.copySuccess');
      setTimeout(() => { copyBtn.textContent = t('outline.copy'); }, 1500);
    }).catch(() => {});
  });

  const exportBtn = document.createElement('button'); exportBtn.className = 'outline-action-btn'; exportBtn.textContent = t('outline.export');
  exportBtn.addEventListener('click', () => {
    const now = new Date();
    const dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    downloadFile(outlineToMarkdown(data), t('outline.title') + '_' + dateStr + '.md', 'text/markdown;charset=utf-8');
  });

  footer.appendChild(copyBtn);
  footer.appendChild(exportBtn);
  container.appendChild(footer);

  return container;
}

function renderOutlineSkeleton(): HTMLDivElement {
  const skeleton = document.createElement('div');
  skeleton.className = 'outline-skeleton';
  for (let i = 0; i < 5; i++) {
    const line = document.createElement('div'); line.className = 'outline-skeleton-line';
    skeleton.appendChild(line);
  }
  return skeleton;
}

export function generateOutline(): void {
  if (state.getIsGenerating()) return;

  const pageContent = state.getPageContent();

  if (!pageContent) {
    _extractPageContent().then(() => {
      if (state.getIsGenerating()) return;
      if (!state.getPageContent()) { appendMessage('error', t('outline.noContent')); return; }
      if (state.getPageContent().trim().length < 200) { appendMessage('error', t('outline.tooShort')); return; }
      doGenerateOutline();
    }).catch(() => { appendMessage('error', t('outline.noContent')); });
    return;
  }

  if (pageContent.trim().length < 200) { appendMessage('error', t('outline.tooShort')); return; }

  doGenerateOutline();
}

function doGenerateOutline(): void {
  state.setIsGenerating(true);
  setButtonsDisabled(true);

  stopTTS();
  emit(EVENTS.REMOVE_SUGGEST_QUESTIONS);

  const chatArea = document.getElementById('chatArea')!;
  const welcome = chatArea.querySelector('.welcome-msg');
  if (welcome) welcome.remove();

  const msgEl = appendMessage('ai', '');
  msgEl.appendChild(renderOutlineSkeleton());
  scrollToBottom();

  const messages: { role: 'system' | 'user'; content: string }[] = [];
  const context = safeTruncate(state.getPageContent(), TRUNCATE_LIMITS.CONTEXT);
  messages.push({ role: 'system', content: t('prompt.outline') });

  const customSystemPrompt = state.getCustomSystemPrompt();
  if (customSystemPrompt) messages.push({ role: 'system', content: customSystemPrompt });

  messages.push({ role: 'user', content: context! });

  const port = chrome.runtime.connect({ name: 'ai-chat' });

  port.postMessage({ type: 'chat', messages, response_format: { type: 'json_object' } });

  let fullText = '';

  port.onDisconnect.addListener(() => {
    if (state.getIsGenerating()) {
      if (!fullText) {
        msgEl.className = 'message message-error';
        msgEl.innerHTML = escapeHtml(t('error.apiFailed'))!;
      }
      state.setIsGenerating(false);
      setButtonsDisabled(false);
    }
  });

  port.onMessage.addListener((msg: { type: string; content?: string; error?: string; errorKey?: string }) => {
    if (msg.type === 'thinking') {
      // Ignore
    } else if (msg.type === 'chunk') {
      fullText += msg.content || '';
    } else if (msg.type === 'done') {
      port.disconnect();
      msgEl.innerHTML = '';

      const data = parseOutlineResponse(fullText);
      if (data) {
        msgEl.appendChild(renderOutline(data));
        msgEl.dataset.type = 'outline';
        msgEl.dataset.json = fullText;
        state.pushConversation({ role: 'user', content: '[大纲请求] ' + context!.slice(0, 100) });
        state.pushConversation({ role: 'assistant', content: fullText, type: 'outline' });
      } else {
        msgEl.innerHTML = marked.parse(fullText) as string;
        state.pushConversation({ role: 'assistant', content: fullText });
      }

      state.setIsGenerating(false);
      setButtonsDisabled(false);
      emit(EVENTS.ADD_TTS_BUTTON, { msgEl });
      emit(EVENTS.SAVE_CURRENT_CHAT);
      scrollToBottom();
    } else if (msg.type === 'error') {
      port.disconnect();
      const errorText = msg.errorKey ? t(msg.errorKey) : (msg.error || '');
      msgEl.className = 'message message-error';
      msgEl.innerHTML = escapeHtml(errorText)!;
      state.setIsGenerating(false);
      setButtonsDisabled(false);
    }
  });
}

export function renderOutlineFromJSON(jsonString: string): HTMLDivElement | null {
  const data = parseOutlineResponse(jsonString);
  if (!data) return null;
  return renderOutline(data);
}
