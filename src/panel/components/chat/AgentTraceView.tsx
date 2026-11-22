import type { AgentRound } from '@/panel/stores/stream-store';
import type { AgentTraceStep } from '@/shared/types';

/**
 * Agent tool-trace view — live (from the stream store) or persisted
 * (AgentTraceStep[] on a history message). Display order is stable while
 * executions light up independently, mirroring the legacy trace semantics.
 */
export function AgentTraceView({ rounds, steps }: { rounds?: AgentRound[]; steps?: AgentTraceStep[] }) {
  if (!rounds?.length && !steps?.length) return null;
  return (
    <div className="agent-steps">
      {rounds?.map(round => (
        <div key={round.round} className="agent-round">
          {round.round > 1 && <div className="agent-round-header">第 {round.round} 轮</div>}
          {round.calls.map(call => (
            <details key={call.id} className={`agent-step${call.result !== undefined ? ' done' : ''}`}>
              <summary>
                <span className="agent-tool-name">{call.name}</span>
                <span className="agent-tool-args">{shortArgs(call.arguments)}</span>
              </summary>
              {call.result !== undefined && <pre className="agent-tool-result">{call.result}</pre>}
            </details>
          ))}
        </div>
      ))}
      {steps && rounds === undefined && (
        <div className="agent-round">
          {steps.map((step, i) => (
            <details key={i} className="agent-step done">
              <summary>
                <span className="agent-tool-name">{step.name}</span>
                <span className="agent-tool-args">{step.args}</span>
              </summary>
              <pre className="agent-tool-result">{step.result}</pre>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function shortArgs(argsJson: string): string {
  try {
    const parsed = JSON.parse(argsJson || '{}') as Record<string, unknown>;
    const parts = Object.entries(parsed).map(([k, v]) => {
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return s.length > 40 ? `${k}=${s.slice(0, 40)}…` : `${k}=${s}`;
    });
    return parts.join(' ') || '{}';
  } catch {
    return argsJson.slice(0, 60);
  }
}
