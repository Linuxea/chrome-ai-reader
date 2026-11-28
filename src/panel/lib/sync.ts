/**
 * F17 cross-surface sync — every surface bound to the same tab (the side
 * panel + the fullscreen tab, each an independent extension page rendering
 * the SAME `TabState`) shows the same conversation, live.
 *
 * The model, end to end:
 * - `chrome.storage.session` is the shared bus. Every mutation the core
 *   persists there (message boundaries immediately, field setters
 *   debounced) already reaches the other surface's `storage.onChanged`
 *   listener — that listener applies the remote state IN PLACE (field-wise,
 *   never replacing the TabState object, so the history-ops in-place
 *   contract and any captured references keep working). Applying never
 *   persists, so there is no echo loop.
 * - Live STREAMING is not in storage (stream-store is per-page display
 *   state), so the owning page relays its port events over the runtime
 *   channel and passive surfaces mirror them into their own stream-store.
 * - `isGenerating` is the cross-surface busy lock: the page that opened the
 *   ai-chat port owns it; passive surfaces adopt it, which blocks a second
 *   send into the same conversation from another window.
 * - Stop works from any surface: a passive stop is relayed to the owner;
 *   if no owner answers (its page died mid-stream leaving a stale flag),
 *   the surface self-heals after a grace window.
 *
 * Deliberately NOT synced (window-local, like two devices):
 * - the composer draft and pending attachments,
 * - `isPodcastGenerating` / `quizSession.generating` while either side is
 *   mid-flight (podcast audio and quiz streams die with their page),
 * - suggestion chips (ephemeral per-page UI),
 * - image data URLs (storage persistence strips them, same as a reload).
 */
import type { ChatMessage, TabState } from '@/shared/types';
import type { FinishReason, StreamMessage, TokenUsage } from '@/shared/protocol';
import { onStorageChanged } from '@/platform/storage';
import { onMessage } from '@/platform/messaging';
import { t } from '@/shared/i18n.js';
import * as core from '@/panel/state';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { useStreamStore } from '@/panel/stores/stream-store';
import { useUIStore } from '@/panel/stores/ui-store';
import { ownsGeneration, abortGeneration } from './stream-controller';

export interface StreamEndPayload {
  kind: 'done' | 'aborted' | 'error';
  finishReason?: FinishReason;
  usage?: TokenUsage;
  model?: string;
  /** aborted: the quiet "stopped" note. */
  note?: string;
  errorText?: string;
  errorKey?: string;
  /** aborted / error: keeps the rolled-back user turn retryable, as on the owner. */
  failedUserMessage?: ChatMessage;
}

/**
 * Apply another surface's persisted TabState onto ours, in place.
 *
 * In-flight flags follow ownership, not the wire: the page that owns the
 * live work keeps its own value — the remote copy may carry a stale mirror
 * (or a passive page's self-heal "false" racing a live owner). Quiz state
 * applies only when NEITHER side is mid-quiz, for the same reason.
 */
export function applyRemoteTabState(tabId: number, remote: TabState): void {
  const ts = core.getStateForTab(tabId);
  if (!ts) return;

  if (!ownsGeneration(tabId)) ts.isGenerating = !!remote.isGenerating;
  if (!ts.quizSession?.generating && !remote.quizSession?.generating) {
    ts.quizSession = remote.quizSession;
  }
  // isPodcastGenerating is window-local (audio dies with its page): never
  // taken from the wire.

  ts.pageContent = remote.pageContent ?? '';
  ts.pageExcerpt = remote.pageExcerpt ?? '';
  ts.pageTitle = remote.pageTitle ?? '';
  ts.pageUrl = remote.pageUrl ?? '';
  ts.pageParagraphs = remote.pageParagraphs ?? [];
  ts.selectedText = remote.selectedText ?? '';
  ts.imageIndex = remote.imageIndex ?? 0;
  ts.currentChatId = remote.currentChatId ?? null;
  ts.chatTitle = remote.chatTitle ?? '';
  ts.conversationHistory = remote.conversationHistory ?? [];
  ts.branches = remote.branches;

  // A finished remote stream means our live mirror is over: drop it before
  // it double-renders next to the answer that just arrived via history.
  // An error/aborted mirror stays — it holds the retry affordance, exactly
  // like the owner keeps its entry after a failed send.
  if (!remote.isGenerating && !ownsGeneration(tabId)) {
    const live = useStreamStore.getState().streams[tabId];
    if (live && (live.status === 'streaming' || live.status === 'done')) {
      useStreamStore.getState().clear(tabId);
    }
  }

  // Re-render + re-mirror the active tab's busy flag. No persist — the
  // writer already stored this state; persisting here would only echo it.
  useTabsStore.getState().bump();
}

/**
 * Install this surface's sync listeners. Called once from the shared
 * liftoff (both the side panel and the fullscreen page).
 */
export function installStateSync(): () => void {
  const offStorage = onStorageChanged((changes, area) => {
    if (area !== 'session') return;
    const tabId = core.getActiveTabId();
    if (tabId == null) return;
    const change = changes[`tabState_${tabId}`];
    // A removal (tab closed) is handled by the core's own lifecycle listener.
    if (!change || change.newValue === undefined) return;
    applyRemoteTabState(tabId, change.newValue as TabState);
  });

  const offMessage = onMessage(msg => {
    const action = msg.action as string;
    if (typeof action !== 'string' || !action.startsWith('sync.')) return;
    const tabId = core.getActiveTabId();
    if (tabId == null || msg.tabId !== tabId) return;

    if (action === 'sync.stopRequest') {
      // Only the owner may abort — a passive page answering would only add
      // a junk pending abort that a future send would wrongly consume.
      if (ownsGeneration(tabId)) abortGeneration(tabId);
      return;
    }
    if (action === 'sync.streamStart') {
      mirrorStart(tabId);
      return;
    }
    if (action === 'sync.stream') {
      mirrorStreamEvent(tabId, msg.msg as StreamMessage);
      return;
    }
    if (action === 'sync.streamEnd') {
      mirrorStreamEnd(tabId, msg.payload as StreamEndPayload);
    }
  });

  return () => { offStorage(); offMessage(); };
}

/** The owning page opened its port — mirror a live entry (typing indicator). */
function mirrorStart(tabId: number): void {
  if (ownsGeneration(tabId)) return;
  const api = useStreamStore.getState();
  if (!api.streams[tabId]) api.start(tabId);
}

/** One relayed port event, mirrored into this surface's stream-store. */
function mirrorStreamEvent(tabId: number, msg: StreamMessage): void {
  if (ownsGeneration(tabId)) return;
  const api = useStreamStore.getState();
  // Lazy start: a surface that opened mid-stream gets its entry at the
  // first relayed event (it will show a partial answer until finalize).
  if (!api.streams[tabId]) api.start(tabId);
  if (msg.type === 'thinking') {
    api.appendThinking(tabId, msg.content || '');
  } else if (msg.type === 'chunk') {
    api.appendAnswer(tabId, msg.content || '');
  } else if (msg.type === 'search_event') {
    api.addSearchEvent(tabId, msg.event);
  } else if (msg.type === 'retry') {
    api.restart(tabId);
    useUIStore.getState().pushToast(t('ai.retrying'));
  }
}

/** The owner finalized — settle this surface's live mirror the same way. */
function mirrorStreamEnd(tabId: number, payload: StreamEndPayload): void {
  if (ownsGeneration(tabId)) return;
  const api = useStreamStore.getState();
  if (!api.streams[tabId]) return;
  if (payload.kind === 'done') {
    api.finish(tabId, { finishReason: payload.finishReason, usage: payload.usage, model: payload.model });
  } else if (payload.kind === 'aborted') {
    api.abort(tabId, payload.note || t('ai.stopped'), payload.failedUserMessage);
  } else if (payload.kind === 'error') {
    api.fail(tabId, payload.errorText || t('error.apiFailed'), payload.failedUserMessage, payload.errorKey);
  }
}

/**
 * Boot-time adoption: `restoreTabState` strips in-flight flags (the writer
 * of a stored `isGenerating: true` used to be dead by definition). With a
 * second surface it may be VERY alive — the fullscreen page opening mid-
 * answer must not double-send into the conversation. Adopt the stored flag;
 * if it turns out stale (writer died), the stop button's self-heal releases
 * it. `isPodcastGenerating` / quiz streams stay unadopted: their audio and
 * streams die with their page, and adopting would block features no one is
 * driving.
 */
export async function adoptStoredInFlightFlag(tabId: number): Promise<void> {
  if (ownsGeneration(tabId)) return;
  const key = `tabState_${tabId}`;
  const stored = await chrome.storage.session.get(key);
  const raw = stored[key] as TabState | undefined;
  if (raw?.isGenerating) {
    useTabsStore.getState().setGeneratingForTab(tabId, true);
  }
}
