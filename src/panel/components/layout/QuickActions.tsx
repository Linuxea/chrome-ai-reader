import { useState } from 'react';
import { FileText, Languages, KeyRound, HelpCircle, BookOpenText, GraduationCap, Podcast, PenLine, CircleCheck, Clock, AlertTriangle } from 'lucide-react';
import { handleQuickAction } from '@/panel/lib/quick-action-handler';
import { useAnnotationStore, onAnnotationClick, annotationFor } from '@/panel/lib/annotation';
import { useUIStore } from '@/panel/stores/ui-store';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { sendToContentScript } from '@/platform/messaging';
import * as core from '@/panel/state';
import { startQuiz } from '@/panel/lib/quiz-controller';
import { startPodcast } from '@/panel/lib/podcast-controller';
import { t } from '@/shared/i18n.js';

/** Tool-style chips: immersive toggle + prompt-backed actions + features. */
export function QuickActions() {
  const [immersiveOn, setImmersiveOn] = useState(false);
  useTabsStore(s => s.version);
  const activeTabId = useTabsStore(s => s.activeTabId);
  const byTab = useAnnotationStore(s => s.byTab);
  const annotation = (activeTabId != null && byTab[activeTabId]) || { kind: 'idle' as const };

  return (
    <div className="quick-actions">
      <QuickChip label={t('action.summarize')} Icon={FileText} onClick={() => void handleQuickAction('summarize')} />
      <QuickChip label={t('action.translate')} Icon={Languages} onClick={() => void handleQuickAction('translate')} />
      <QuickChip label={t('action.keyInfo')} Icon={KeyRound} onClick={() => void handleQuickAction('keyInfo')} />
      <QuickChip label={t('action.explain')} Icon={HelpCircle} onClick={() => void handleQuickAction('explain')} />
      <QuickChip label={t('action.immersive')} Icon={BookOpenText} active={immersiveOn} onClick={() => void toggleImmersive(setImmersiveOn)} />
      <QuickChip label={t('action.quiz')} Icon={GraduationCap} onClick={() => void startQuiz()} />
      <QuickChip label={t('podcast.button')} Icon={Podcast} onClick={() => void startPodcast()} />
      <AnnotationChip state={annotation} />
    </div>
  );
}

function QuickChip({ label, Icon, onClick, active }: { label: string; Icon: typeof FileText; onClick: () => void; active?: boolean }) {
  return (
    <button className={`action-chip${active ? ' active' : ''}`} onClick={onClick}>
      <Icon size={14} />
      <span>{label}</span>
    </button>
  );
}

function AnnotationChip({ state }: { state: { kind: string; done?: number; total?: number; count?: number; failed?: number; error?: string } }) {
  const label =
    state.kind === 'annotating'
      ? t('annotation.buttonActive', { done: state.done ?? 0, total: state.total ?? 0 })
      : state.kind === 'done'
        ? t('annotation.buttonDone', { n: state.count ?? 0 })
        : state.kind === 'error'
          ? t('annotation.error')
          : t('annotation.button');
  const Icon = state.kind === 'annotating' ? Clock : state.kind === 'done' ? CircleCheck : state.kind === 'error' ? AlertTriangle : PenLine;
  const title =
    state.kind === 'done' && (state.failed ?? 0) > 0
      ? t('annotation.donePartialTitle', { failed: state.failed ?? 0 })
      : state.kind === 'error' && state.error
        ? t('annotation.errorTitle', { error: state.error })
        : undefined;
  return (
    <button
      className={`action-chip${state.kind === 'done' || state.kind === 'error' ? ' done' : ''}${state.kind === 'annotating' ? ' busy' : ''}`}
      onClick={() => void onAnnotationClick()}
      title={title}
    >
      <Icon size={14} />
      <span>{label}</span>
    </button>
  );
}

async function toggleImmersive(setOn: (v: boolean) => void): Promise<void> {
  const tabId = core.getActiveTabId();
  if (tabId == null) return;
  try {
    const res = await sendToContentScript<{ active?: boolean }>(tabId, { action: 'immersiveToggle' });
    setOn(res?.active === true);
    if (res?.active) useUIStore.getState().pushToast(t('immersive.started'));
  } catch {
    useUIStore.getState().pushToast(t('error.pageUnsupported'), 'error');
  }
}

export { annotationFor };
