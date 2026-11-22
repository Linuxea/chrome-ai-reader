import { useTabsStore } from '@/panel/stores/tabs-store';
import { useUIStore } from '@/panel/stores/ui-store';

/**
 * `/` quick-command popup — filters the user's custom quick commands.
 * DUMB by design: keyboard navigation + Enter are handled in the Composer's
 * keydown (the popup must not steal focus from the textarea). The text typed
 * after the command name rides along as the draft (legacy semantics).
 */
export function CommandPopup({ onPick }: { onPick: (prompt: string, display: string, draft: string | undefined) => void }) {
  const popup = useUIStore(s => s.commandPopup);
  const quickCommands = useTabsStore(s => s.quickCommands);

  if (!popup.open) return null;

  const query = popup.query.replace(/^\//, '');
  const matches = quickCommands.filter(c => c.name.toLowerCase().includes(query.toLowerCase()));
  const highlighted = Math.min(popup.highlighted, Math.max(matches.length - 1, 0));

  return (
    <div className="command-popup" role="listbox" aria-label="quick commands">
      <div className="command-list">
        {matches.length === 0 && <div className="command-empty">没有匹配的命令</div>}
        {matches.map((cmd, i) => (
          <button
            key={cmd.id ?? cmd.name}
            role="option"
            aria-selected={i === highlighted}
            className={`command-item${i === highlighted ? ' highlighted' : ''}`}
            onMouseEnter={() => useUIStore.getState().setCommandHighlight(i)}
            onMouseDown={e => e.preventDefault()}
            onClick={() => pick(cmd.name, cmd.prompt)}
          >
            <span className="command-name">{cmd.name}</span>
            <span className="command-prompt">{cmd.prompt.slice(0, 60)}</span>
          </button>
        ))}
      </div>
      <div className="command-hint">↑↓ 选择 · Enter 运行 · Esc 关闭</div>
    </div>
  );

  function pick(name: string, prompt: string): void {
    const rest = query.toLowerCase().startsWith(name.toLowerCase()) ? query.slice(name.length).trim() : '';
    onPick(prompt, name, rest || undefined);
  }
}

export function commandMatchesCount(): number {
  const popup = useUIStore.getState().commandPopup;
  const quickCommands = useTabsStore.getState().quickCommands;
  if (!popup.open) return 0;
  const query = popup.query.replace(/^\//, '');
  return quickCommands.filter(c => c.name.toLowerCase().includes(query.toLowerCase())).length;
}
