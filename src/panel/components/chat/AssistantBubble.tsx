import { memo, useState } from 'react';
import type { ChatMessage } from '@/shared/types';
import { MarkdownView } from './MarkdownView';
import { AgentTraceView } from './AgentTraceView';
import { WebTraceView } from './WebTraceView';
import { AnswerActions } from './AnswerActions';
import { useUIStore } from '@/panel/stores/ui-store';
import { t } from '@/shared/i18n.js';

/** A finished assistant answer, rendered from history (markdown + trace + notes + actions). */
export const AssistantBubble = memo(function AssistantBubble({ msg, tabId }: { msg: ChatMessage; tabId?: number | null }) {
  const text = typeof msg.content === 'string' ? msg.content : '';
  const openShare = useUIStore(s => s.openShare);
  return (
    <div className="ai-msg" data-msg-id={msg.id}>
      {msg.agentTrace && msg.agentTrace.length > 0 && <AgentTraceView steps={msg.agentTrace} />}
      {/* F15: the searches this answer used, and its cited sources as chips. */}
      {msg.web && <WebTraceView steps={msg.web.steps} />}
      <MarkdownView text={text} web={msg.web} />
      {msg.finish?.reason === 'length' && (
        <div className="msg-note">
          {msg.finish.limit === 'steps' ? t('agent.stepLimit') : t('ai.truncatedByLimit')}
        </div>
      )}
      {msg.finish?.reason === 'refusal' && <div className="msg-note">{t('ai.refusedPartway')}</div>}
      {msg.finish?.usage && (
        <div className="answer-usage">
          {t('ai.usage', {
            model: msg.finish.model ?? '',
            in: String(msg.finish.usage.inputTokens),
            out: String(msg.finish.usage.outputTokens),
          })}
        </div>
      )}
      <AnswerActions msgId={msg.id ?? ''} markdown={text} tabId={tabId ?? null} onShare={() => openShare(msg.id ?? '')} />
    </div>
  );
});

/** Collapsible reasoning block — live while streaming, collapsed summary after. */
export function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(true);
  if (!text) return null;
  return (
    <details className="thinking-block" open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="thinking-summary">{t('ai.thinking')}</summary>
      <div className="thinking-content">
        <MarkdownView text={text} />
      </div>
    </details>
  );
}
