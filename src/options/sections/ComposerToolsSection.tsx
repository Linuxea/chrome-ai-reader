/**
 * Composer-tools section — which attachment actions sit directly in the
 * input bar and which fold into the "+" overflow menu. Writes
 * immediately in COMPOSER_TOOL_IDS order; an empty selection is a valid
 * state (everything lives in the menu).
 */
import { COMPOSER_TOOL_IDS, type ComposerToolId } from '@/platform/settings';
import { t } from '@/shared/i18n.js';
import { useSettingsStore } from '../settings-store';
import { SectionCard } from '../components/SectionCard';
import { ToggleRow } from '../components/ToggleRow';

const TOOL_LABEL_KEYS: Record<ComposerToolId, string> = {
  capture: 'sidebar.visionCapture',
  captureFull: 'sidebar.visionCaptureFull',
  upload: 'sidebar.uploadImage',
  tabs: 'sidebar.attachTabs',
};

export function ComposerToolsSection() {
  useSettingsStore(s => s.lang);
  const composerTools = useSettingsStore(s => s.composerTools);
  const setComposerTools = useSettingsStore(s => s.setComposerTools);

  const toggleTool = (id: ComposerToolId, shown: boolean) => {
    // Keep COMPOSER_TOOL_IDS order — the panel renders by it.
    const next = shown
      ? COMPOSER_TOOL_IDS.filter(tool => tool === id || composerTools.includes(tool))
      : composerTools.filter(tool => tool !== id);
    setComposerTools(next);
  };

  return (
    <SectionCard title={t('settings.composerTools')}>
      <p
        className="field-hint"
        dangerouslySetInnerHTML={{ __html: t('settings.composerTools.hint') }}
      />
      {COMPOSER_TOOL_IDS.map(id => (
        <ToggleRow
          key={id}
          label={t(TOOL_LABEL_KEYS[id])}
          checked={composerTools.includes(id)}
          onChange={v => toggleTool(id, v)}
        />
      ))}
    </SectionCard>
  );
}
