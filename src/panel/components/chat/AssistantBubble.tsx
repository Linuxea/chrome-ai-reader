import { memo, useState } from 'react';
import type { ChatMessage } from '@/shared/types';
import { MarkdownView } from './MarkdownView';
import { AgentTraceView } from './AgentTraceView';
import { AnswerActions } from './AnswerActions';
import { useUIStore } from '@/panel/stores/ui-store';

/** A finished assistant answer, rendered from history (markdown + trace + actions). */
export const AssistantBubble = memo(function AssistantBubble({ msg }: { msg: ChatMessage; tabId?: number | null }) {
  const text = typeof msg.content === 'string' ? msg.content : '';
  const openShare = useUIStore(s => s.openShare);
  return (
    <div className="ai-msg" data-msg-id={msg.id}>
      {msg.agentTrace && msg.agentTrace.length > 0 && <AgentTraceView steps={msg.agentTrace} />}
      <MarkdownView text={text} />
      <AnswerActions msgId={msg.id ?? ''} markdown={text} onShare={() => openShare(msg.id ?? '')} />
    </div>
  );
});

/** Collapsible reasoning block — live while streaming, collapsed summary after. */
export function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(true);
  if (!text) return null;
  return (
    <details className="thinking-block" open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="thinking-summary">思考中…</summary>
      <div className="thinking-content">
        <MarkdownView text={text} />
      </div>
    </details>
  );
}
