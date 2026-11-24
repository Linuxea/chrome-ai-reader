/**
 * LLM section — provider, credentials, model, and the answer-behavior
 * toggles. Everything persists immediately (D-2): the select and toggles
 * write on change, the text fields debounce + flush on blur.
 */
import {
  DEFAULT_ANTHROPIC_API_BASE,
  DEFAULT_API_BASE,
} from '@/platform/settings';
import { t } from '@/shared/i18n.js';
import { useSettingsStore } from '../settings-store';
import { SectionCard } from '../components/SectionCard';
import { TextField } from '../components/TextField';
import { ToggleRow } from '../components/ToggleRow';
import { RefreshCw } from 'lucide-react';

export function LlmSection() {
  // Re-render on language change: every label below goes through t().
  useSettingsStore(s => s.lang);

  const provider = useSettingsStore(s => s.provider);
  const apiKey = useSettingsStore(s => s.apiKey);
  const apiBase = useSettingsStore(s => s.apiBase);
  const modelName = useSettingsStore(s => s.modelName);
  const systemPrompt = useSettingsStore(s => s.systemPrompt);
  const citations = useSettingsStore(s => s.citations);
  const webSearch = useSettingsStore(s => s.webSearch);
  const agentMode = useSettingsStore(s => s.agentMode);
  const models = useSettingsStore(s => s.models);
  const modelsLoading = useSettingsStore(s => s.modelsLoading);

  const setText = useSettingsStore(s => s.setText);
  const blurText = useSettingsStore(s => s.blurText);
  const setToggle = useSettingsStore(s => s.setToggle);
  const setProvider = useSettingsStore(s => s.setProvider);
  const refreshModels = useSettingsStore(s => s.refreshModels);

  // Placeholders follow the provider so an empty field shows what will
  // be used (legacy syncProviderHints).
  const defaultBase = provider === 'anthropic' ? DEFAULT_ANTHROPIC_API_BASE : DEFAULT_API_BASE;
  const apiKeyPlaceholder = provider === 'anthropic' ? 'sk-ant-...' : 'sk-...';

  // The sk- prefix heuristic is a NON-blocking hint now (legacy behavior
  // hard-blocked the save button — D-2 removed the button): keys for
  // OpenAI-compatible endpoints usually start with sk-, unless a custom
  // base URL says otherwise (Ollama & friends).
  const apiKeyWarning =
    provider === 'openai' && apiKey.trim() !== '' && !apiKey.trim().startsWith('sk-') && apiBase.trim() === ''
      ? t('error.apiKeyHint')
      : null;

  return (
    <SectionCard title={t('settings.llm')}>
      <div className="form-group">
        <label className="field-label" htmlFor="provider">
          <span>{t('settings.llm.provider')}</span>
        </label>
        <select
          id="provider"
          className="field-input"
          value={provider}
          onChange={e => setProvider(e.target.value === 'anthropic' ? 'anthropic' : 'openai')}
        >
          <option value="openai">{t('settings.llm.provider.openai')}</option>
          <option value="anthropic">{t('settings.llm.provider.anthropic')}</option>
        </select>
      </div>

      <TextField
        label={t('settings.llm.apiKey')}
        value={apiKey}
        onChange={v => setText('apiKey', v)}
        onBlur={() => blurText('apiKey')}
        placeholder={apiKeyPlaceholder}
        password
        warning={apiKeyWarning}
        hint={t('settings.llm.apiKey.hint')}
        savedKey="apiKey"
      />

      <TextField
        label={t('settings.llm.apiBase')}
        value={apiBase}
        onChange={v => setText('apiBase', v)}
        onBlur={() => blurText('apiBase')}
        placeholder={defaultBase}
        hint={t('settings.llm.apiBase.hint')}
        savedKey="apiBase"
      />

      <div className="form-group">
        <label className="field-label" htmlFor="modelName">
          <span>{t('settings.llm.model')}</span>
        </label>
        <div className="field-input-row">
          <input
            id="modelName"
            className="field-input"
            type="text"
            list="model-list"
            value={modelName}
            onChange={e => setText('modelName', e.target.value)}
            onBlur={() => blurText('modelName')}
            placeholder={t('settings.llm.model.ph')}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="refresh-btn"
            onClick={() => void refreshModels()}
            disabled={modelsLoading}
          >
            <RefreshCw size={14} className={modelsLoading ? 'spin' : ''} />
            {modelsLoading ? t('status.loading') : t('settings.llm.refreshModels')}
          </button>
        </div>
        <datalist id="model-list">
          {models.map(id => (
            <option key={id} value={id} />
          ))}
        </datalist>
        <p className="field-hint">{t('settings.llm.model.hint')}</p>
      </div>

      <ToggleRow
        label={t('settings.llm.citations')}
        checked={citations}
        onChange={v => setToggle('citations', v)}
      />
      <ToggleRow
        label={t('settings.llm.webSearch')}
        checked={webSearch}
        onChange={v => setToggle('webSearch', v)}
        hint={t('settings.llm.webSearch.hint')}
      />
      <ToggleRow
        label={t('settings.llm.agentMode')}
        checked={agentMode}
        onChange={v => setToggle('agentMode', v)}
      />

      <TextField
        label={t('settings.llm.systemPrompt')}
        value={systemPrompt}
        onChange={v => setText('systemPrompt', v)}
        onBlur={() => blurText('systemPrompt')}
        placeholder={t('settings.llm.systemPrompt.ph')}
        multiline
        rows={4}
        hint={t('settings.llm.systemPrompt.hint')}
        savedKey="systemPrompt"
      />
    </SectionCard>
  );
}
