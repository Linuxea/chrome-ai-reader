/**
 * Suggest-questions section — the single "generate follow-up questions"
 * toggle. Writes immediately (the panel reads it per answer).
 */
import { t } from '@/shared/i18n.js';
import { useSettingsStore } from '../settings-store';
import { SectionCard } from '../components/SectionCard';
import { ToggleRow } from '../components/ToggleRow';

export function SuggestSection() {
  useSettingsStore(s => s.lang);
  const suggestQuestions = useSettingsStore(s => s.suggestQuestions);
  const setToggle = useSettingsStore(s => s.setToggle);

  return (
    <SectionCard title={t('settings.suggest')}>
      <ToggleRow
        label={t('settings.suggest.toggle')}
        checked={suggestQuestions}
        onChange={v => setToggle('suggestQuestions', v)}
      />
    </SectionCard>
  );
}
