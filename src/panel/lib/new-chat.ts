/**
 * "New chat" — one implementation for every surface (side panel header,
 * fullscreen sidebar). The outgoing conversation is saved first (its tail
 * is never lost), then per-tab leftovers that must not leak into the new
 * chat are dropped: suggestion chips, pending images/tabs, the page cache
 * and the title. Extracted from Header (F17) so the fullscreen sidebar
 * starts chats with byte-identical semantics.
 */
import { saveCurrentChat } from './chat-save';
import { removeSuggestions } from './suggest';
import * as core from '@/panel/state';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { useComposerStore } from '@/panel/stores/composer-store';
import { useUIStore } from '@/panel/stores/ui-store';
import { t } from '@/shared/i18n.js';

export function startNewChat(): void {
  const store = useTabsStore.getState();
  if (store.isGenerating) {
    useUIStore.getState().pushToast(t('toast.busyGenerating'));
    return;
  }
  void saveCurrentChat();
  // The outgoing conversation's suggestion chips and pending image
  // previews must not leak into the new chat (a stray chip would fill the
  // input with the OLD page's question; a pending image would silently ride
  // the new chat's first message).
  const tabId = store.activeTabId;
  if (tabId != null) removeSuggestions(tabId);
  useComposerStore.setState({ images: [], tabs: [] });
  store.setPageContent('');
  store.setPageExcerpt('');
  store.setPageTitle('');
  store.clearConversation();
  store.setCurrentChatId(null);
  // The new conversation has no title yet — the placeholder shows until
  // its first answer completes.
  store.setChatTitle('');
  store.setSelectedText('');
  // Belt-and-braces: the page cache fields above went through debounced
  // persistence; a surface reading the raw storage right now (the other
  // window's sync apply, or a fresh fullscreen page) should not see a
  // half-cleared state.
  if (tabId != null) core.persistForTab(tabId);
}
