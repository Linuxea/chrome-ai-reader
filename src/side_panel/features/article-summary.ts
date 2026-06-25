import { t, getCurrentLang } from '../../shared/i18n.js';
import { getPrompt } from '../../shared/prompts';
import { TRUNCATE_LIMITS, safeTruncate, escapeHtml } from '../../shared/constants';
import type { AIChatRequest, StreamMessage } from '../../shared/protocol';
import type { ChatMessage } from '../../shared/types';
import { openAIChatPort } from '../../platform/ports';
import { EVENTS, on } from '../events';
import * as state from '../state';
import { marked } from 'marked';

let chatArea: HTMLElement | null = null;
let currentCard: HTMLElement | null = null;
let pendingRequest: ArticleSummaryRequest | null = null;

export interface ArticleSummaryDeps {
  chatArea: HTMLElement;
}

export interface ArticleSummaryRequest {
  tabId: number;
  url: string;
  title: string;
  content: string;
}

export function initArticleSummary(deps: ArticleSummaryDeps): void {
  chatArea = deps.chatArea;
  renderStoredArticleSummary();
  on(EVENTS.PAGE_EXTRACTED, ({ tabId, url, title, content }) => {
    if (!tabId || !content) return;
    pendingRequest = { tabId, url, title, content };
    void requestArticleSummary(pendingRequest);
  });
  on(EVENTS.TAB_CHANGED, () => renderStoredArticleSummary());
  on(EVENTS.REQUEST_RERENDER, () => renderStoredArticleSummary());
}

export function renderStoredArticleSummary(): void {
  const summary = state.getArticleSummary();
  const status = state.getArticleSummaryStatus();
  if (status === 'generating') renderArticleSummary('', 'generating');
  else if (summary) renderArticleSummary(summary, status);
}

export function renderArticleSummary(content: string, status: 'idle' | 'generating' | 'done' | 'error' = 'done'): HTMLElement | null {
  if (!chatArea) return null;
  const welcome = chatArea.querySelector('.welcome-msg');
  if (welcome) welcome.remove();

  if (!currentCard || !currentCard.isConnected) {
    currentCard = document.createElement('section');
    currentCard.className = 'article-summary-card';
    chatArea.prepend(currentCard);
  }

  const body = status === 'generating'
    ? `<div class="article-summary-loading"><span class="article-summary-spinner"></span>${escapeHtml(t('summary.generating'))}</div>`
    : marked.parse(content || '') as string;

  currentCard.innerHTML = `
    <div class="article-summary-label">${escapeHtml(t('summary.title'))}</div>
    <div class="article-summary-body">${body}</div>
  `;
  return currentCard;
}

export async function requestArticleSummary(req: ArticleSummaryRequest): Promise<void> {
  const tabState = state.getStateForTab(req.tabId);
  if (!tabState || tabState.articleSummaryStatus === 'generating') return;
  if (tabState.articleSummary && tabState.articleSummaryUrl === req.url) {
    if (state.getActiveTabId() === req.tabId) renderArticleSummary(tabState.articleSummary, 'done');
    return;
  }

  tabState.articleSummary = '';
  tabState.articleSummaryStatus = 'generating';
  tabState.articleSummaryUrl = req.url;
  if (state.getActiveTabId() === req.tabId) {
    state.setArticleSummary('');
    state.setArticleSummaryStatus('generating');
    state.setArticleSummaryUrl(req.url);
    renderArticleSummary('', 'generating');
  }
  state.persistForTab(req.tabId);

  const lang = getCurrentLang();
  const context = safeTruncate(req.content, TRUNCATE_LIMITS.CONTEXT) ?? '';
  const messages: ChatMessage[] = [
    { role: 'system', content: getPrompt('default', lang, { custom: '' }) },
    { role: 'system', content: getPrompt('default.article', lang, { title: req.title, content: context }) },
    { role: 'user', content: getPrompt('summary.card', lang) },
  ];

  const port = openAIChatPort();
  let fullText = '';
  let settled = false;

  const finish = (status: 'done' | 'error') => {
    if (settled) return;
    settled = true;
    tabState.articleSummary = fullText;
    tabState.articleSummaryStatus = status;
    if (state.getActiveTabId() === req.tabId) {
      state.setArticleSummary(fullText);
      state.setArticleSummaryStatus(status);
    }
    state.persistForTab(req.tabId);
    try { port.disconnect(); } catch { }
    if (state.getActiveTabId() === req.tabId) renderArticleSummary(status === 'done' ? fullText : t('summary.error'), status);
  };

  port.onMessage.addListener((msg: StreamMessage) => {
    if (msg.type === 'chunk') {
      fullText += msg.content || '';
      tabState.articleSummary = fullText;
      if (state.getActiveTabId() === req.tabId) {
        state.setArticleSummary(fullText);
        renderArticleSummary(fullText, 'done');
      }
    } else if (msg.type === 'done') {
      finish('done');
    } else if (msg.type === 'error') {
      fullText = msg.errorKey ? t(msg.errorKey) : msg.error || t('summary.error');
      finish('error');
    }
  });

  port.onDisconnect.addListener(() => {
    if (!settled && tabState.articleSummaryStatus === 'generating') {
      fullText = fullText || t('summary.error');
      finish('error');
    }
  });

  const request: AIChatRequest = { type: 'chat', messages };
  port.postMessage(request);
}

export const __internals = {
  pendingRequest: () => pendingRequest,
  get currentCard() { return currentCard; },
};
