import { FileSearch, Globe, Search } from 'lucide-react';
import type { WebSource } from '@/shared/types';
import { safeHttpUrl } from '@/shared/web-search';
import type { LiveWebStep } from '@/panel/stores/stream-store';
import { t } from '@/shared/i18n.js';

/** Result cards shown under one search call. */
const MAX_RESULTS = 8;

const countPages = (steps: LiveWebStep[]): number =>
  new Set(steps.flatMap((s) => (s.action.type === 'search' ? [] : [s.action.url]))).size;

/** What a call did, in one line: the queries, or the page it opened. */
function detailOf(step: LiveWebStep): string {
  const { action } = step;
  if (action.type === 'search') return action.queries.join('、');
  return step.page?.title || action.url;
}

/**
 * F15: the web search trace above an answer — live (the stream store's
 * steps, while the answer is pending) or persisted (`web.steps` on a history
 * message). One summary line, expandable to one line per server-side call;
 * a finished search line lists its result cards.
 *
 * While live the list is held open so the search is visible as it happens;
 * a persisted trace starts collapsed.
 */
export function WebTraceView({ steps, live = false }: { steps: LiveWebStep[]; live?: boolean }) {
  if (!steps.length) return null;
  const running = live ? steps.find((s) => s.status === 'running') : undefined;
  const searching = running !== undefined;
  const searches = steps.filter((s) => s.action.type === 'search').length;
  const pages = countPages(steps);
  const summary = searching
    ? `${t('web.searching')}${running ? ` ${detailOf(running)}` : ''}`
    : t('web.summary.search', { n: searches }) + (pages ? t('web.summary.pages', { m: pages }) : '');
  return (
    <details className={`web-steps${searching ? ' searching' : ''}`} open={live || undefined}>
      <summary title={summary}>
        <Globe size={13} className="web-glyph" />
        <span>{summary}</span>
      </summary>
      {steps.map((step) => <StepLine key={step.id} step={step} />)}
    </details>
  );
}

function StepLine({ step }: { step: LiveWebStep }) {
  const { action } = step;
  const running = step.status === 'running';
  const Icon = action.type === 'search' ? Search : FileSearch;
  const label = action.type === 'search' ? t('web.action.search')
    : action.type === 'open_page' ? t('web.action.openPage')
    : t('web.action.findInPage');
  const state = running ? ' running' : step.status === 'failed' ? ' failed' : ' done';
  return (
    <div className={`web-step${state}`}>
      <div className="web-step-line">
        <Icon size={12} />
        <span className="web-step-label">{label}</span>
        <span className="web-step-detail">{detailOf(step)}</span>
        {action.type === 'search' && !running && !step.error && step.sources?.length
          ? <span className="web-step-count">{t('web.results', { n: step.sources.length })}</span>
          : null}
      </div>
      {step.error && <div className="web-step-note">{t('web.failed', { code: step.error })}</div>}
      {action.type === 'search' && step.status === 'completed' && !step.sources?.length && (
        <div className="web-step-note">{t('web.noResults')}</div>
      )}
      {action.type === 'search' && !running && step.sources && step.sources.length > 0 && (
        <ul className="web-results">
          {step.sources.slice(0, MAX_RESULTS).map((source) => <ResultCard key={source.url} source={source} />)}
        </ul>
      )}
    </div>
  );
}

/** One search result: title + site name. A link only for http(s) URLs — the URL comes from the API. */
function ResultCard({ source }: { source: WebSource }) {
  const href = safeHttpUrl(source.url);
  return (
    <li>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" title={source.url}>
          {source.title}
          {source.siteName && <span className="web-site">{source.siteName}</span>}
        </a>
      ) : (
        <span title={source.url}>
          {source.title}
          {source.siteName && <span className="web-site">{source.siteName}</span>}
        </span>
      )}
    </li>
  );
}
