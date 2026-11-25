/**
 * Settings store — the options page's single state tree (D-2: everything
 * saves immediately; there is no save button and no "unsaved" state).
 *
 * Timing rules (docs/design/options-react-migration.md §1.2):
 *   - toggles / selects → write on change;
 *   - text fields → state updates at once, persist debounced (500ms) and
 *     flushed on blur; trimmed-empty REMOVES the key (lib/save.ts).
 *
 * `lang` exists to drive re-renders when the UI language changes: t()
 * reads a module-level global in i18n.js, so components must re-render to
 * pick new strings — subscribing to this field is that trigger.
 */
import { create } from 'zustand';
import {
  COMPOSER_TOOL_IDS,
  DEFAULT_ANTHROPIC_API_BASE,
  DEFAULT_API_BASE,
  readStoredSettings,
  writeSettings,
  type ComposerToolId,
  type SettingKey,
  type Settings,
} from '@/platform/settings';
import { setLanguage, t } from '@/shared/i18n.js';
import { applyTheme } from '@/shared/theme';
import {
  createPersistScheduler,
  persistTextField,
  sweepRetiredSaveKeys,
  TEXT_FIELD_KEYS,
  type TextFieldKey,
} from './lib/save';

export type ToggleKey =
  | 'citations'
  | 'webSearch'
  | 'ttsAutoPlay'
  | 'podcastDirect'
  | 'suggestQuestions';

export interface OptionsStatus {
  message: string;
  type: 'success' | 'error';
  /** Bumped per push so an identical message still re-triggers the toast. */
  n: number;
}

export interface SettingsStore {
  loaded: boolean;
  // form values (persisted per the timing rules above)
  provider: 'openai' | 'anthropic';
  apiKey: string;
  apiBase: string;
  modelName: string;
  systemPrompt: string;
  citations: boolean;
  webSearch: boolean;
  ttsAppId: string;
  ttsAccessKey: string;
  ttsResourceId: string;
  podcastResourceId: string;
  ttsSpeaker: string;
  ttsAutoPlay: boolean;
  podcastDirect: boolean;
  suggestQuestions: boolean;
  composerTools: ComposerToolId[];
  themeName: string;
  darkMode: boolean;
  lang: string;
  // feedback
  status: OptionsStatus | null;
  savedTick: Partial<Record<string, number>>;
  // model list
  models: string[];
  modelsLoading: boolean;

  load: () => Promise<void>;
  setToggle: (key: ToggleKey, value: boolean) => void;
  setProvider: (provider: 'openai' | 'anthropic') => void;
  setComposerTools: (ids: ComposerToolId[]) => void;
  setText: (key: TextFieldKey, value: string) => void;
  blurText: (key: TextFieldKey) => void;
  flushPendingPersists: () => void;
  setThemeName: (name: string) => void;
  toggleDarkMode: () => void;
  setLang: (lang: string) => void;
  refreshModels: () => Promise<void>;
  pushStatus: (message: string, type: OptionsStatus['type']) => void;
  clearStatus: () => void;
  markSaved: (key: string) => void;
}

const failToast = (err: unknown): void => {
  useSettingsStore.getState().pushStatus(
    `${t('status.saveFailed')}${err instanceof Error ? `：${err.message}` : ''}`,
    'error',
  );
};

/** Debounced persist continuation: feedback + the apiKey side effect. */
const persistText = async (key: TextFieldKey, raw: string): Promise<void> => {
  const store = useSettingsStore.getState();
  let wrote: boolean;
  try {
    wrote = await persistTextField(key, raw);
    store.markSaved(key);
  } catch (err) {
    failToast(err);
    return;
  }
  // Legacy behavior: a successful save with an apiKey refreshed the model
  // list — keep it for the moment a key lands (blur / debounce).
  if (wrote && key === 'apiKey') void useSettingsStore.getState().refreshModels();
};

const scheduler = createPersistScheduler(persistText);

export const useSettingsStore = create<SettingsStore>()((set, get) => ({
  loaded: false,
  provider: 'openai',
  apiKey: '',
  apiBase: '',
  modelName: '',
  systemPrompt: '',
  citations: true,
  webSearch: true,
  ttsAppId: '',
  ttsAccessKey: '',
  ttsResourceId: '',
  podcastResourceId: '',
  ttsSpeaker: '',
  ttsAutoPlay: false,
  podcastDirect: false,
  suggestQuestions: true,
  composerTools: [...COMPOSER_TOOL_IDS],
  themeName: 'sujian',
  darkMode: false,
  lang: 'zh',
  status: null,
  savedTick: {},
  models: [],
  modelsLoading: false,

  load: async () => {
    const keys = [
      ...TEXT_FIELD_KEYS,
      'provider',
      'citations',
      'webSearch',
      'ttsAutoPlay',
      'podcastDirect',
      'suggestQuestions',
      'composerTools',
      'themeName',
      'darkMode',
      'language',
    ] as const satisfies readonly SettingKey[];
    const data = (await readStoredSettings(keys)) as Record<string, unknown>;
    // Booleans read their SETTING_DEFAULTS stand-in here (webSearch is on
    // by default; the legacy page leaned on the HTML `checked` attribute).
    const bool = (k: string, dflt: boolean): boolean =>
      data[k] === undefined ? dflt : Boolean(data[k]);
    const text = (k: string): string => (typeof data[k] === 'string' ? (data[k] as string) : '');
    const tools = Array.isArray(data.composerTools)
      ? (data.composerTools as unknown[]).filter((id): id is ComposerToolId =>
          (COMPOSER_TOOL_IDS as readonly string[]).includes(id as string),
        )
      : [...COMPOSER_TOOL_IDS];

    set({
      loaded: true,
      provider: data.provider === 'anthropic' ? 'anthropic' : 'openai',
      apiKey: text('apiKey'),
      apiBase: text('apiBase'),
      modelName: text('modelName'),
      systemPrompt: text('systemPrompt'),
      ttsAppId: text('ttsAppId'),
      ttsAccessKey: text('ttsAccessKey'),
      ttsResourceId: text('ttsResourceId'),
      podcastResourceId: text('podcastResourceId'),
      ttsSpeaker: text('ttsSpeaker'),
      citations: bool('citations', true),
      webSearch: bool('webSearch', true),
      ttsAutoPlay: bool('ttsAutoPlay', false),
      podcastDirect: bool('podcastDirect', false),
      suggestQuestions: bool('suggestQuestions', true),
      composerTools: tools,
      themeName: typeof data.themeName === 'string' ? data.themeName : 'sujian',
      darkMode: Boolean(data.darkMode),
      lang: typeof data.language === 'string' ? data.language : 'zh',
    });

    // Retired keys (visionEnabled / ocrApiKey / fastModelName) used to be
    // swept on every save-button click; now once per options load.
    void sweepRetiredSaveKeys().catch(() => {
      /* best-effort cleanup */
    });

    // Reconcile the pre-paint cache with storage truth (legacy behavior).
    applyTheme(get().darkMode, get().themeName, null);

    if (get().apiKey) void get().refreshModels();
  },

  setToggle: (key, value) => {
    const patch: Partial<SettingsStore> = {};
    (patch as Record<string, unknown>)[key] = value;
    set(patch as SettingsStore);
    const write: Partial<Settings> = {};
    (write as Record<SettingKey, unknown>)[key] = value;
    void writeSettings(write).catch(failToast);
  },

  setProvider: provider => {
    set({ provider });
    void writeSettings({ provider }).catch(failToast);
  },

  setComposerTools: ids => {
    set({ composerTools: ids });
    void writeSettings({ composerTools: ids }).catch(failToast);
  },

  setText: (key, value) => {
    const patch: Partial<SettingsStore> = {};
    (patch as Record<string, unknown>)[key] = value;
    set(patch as SettingsStore);
    scheduler.schedule(key, value);
  },

  blurText: key => {
    scheduler.flush(key);
  },

  flushPendingPersists: () => {
    scheduler.flushAll();
  },

  setThemeName: name => {
    set({ themeName: name });
    applyTheme(get().darkMode, name, null);
    void writeSettings({ themeName: name }).catch(failToast);
  },

  toggleDarkMode: () => {
    const next = !get().darkMode;
    set({ darkMode: next });
    applyTheme(next, get().themeName, null);
    void writeSettings({ darkMode: next }).catch(failToast);
  },

  setLang: lang => {
    // setLanguage updates the i18n global (its DOM scan is a no-op here);
    // the state field is what makes components re-render with new t()s.
    setLanguage(lang);
    set({ lang });
    void writeSettings({ language: lang }).catch(failToast);
  },

  refreshModels: async () => {
    const { apiKey, apiBase, provider } = get();
    const key = apiKey.trim();
    if (!key) {
      get().pushStatus(t('error.noApiKeySave'), 'error');
      return;
    }
    const base =
      apiBase.trim() || (provider === 'anthropic' ? DEFAULT_ANTHROPIC_API_BASE : DEFAULT_API_BASE);
    set({ modelsLoading: true });
    try {
      const resp = (await chrome.runtime.sendMessage({
        action: 'fetchModels',
        apiBase: base,
        apiKey: key,
        provider,
      })) as { success: boolean; models?: string[]; error?: string };
      if (resp.success && resp.models) {
        set({ models: resp.models });
        get().pushStatus(t('status.modelsLoaded', { n: resp.models.length }), 'success');
      } else {
        get().pushStatus(resp.error || t('error.fetchModelsFailed'), 'error');
      }
    } catch (err) {
      get().pushStatus(
        `${t('error.fetchModelsFailed')}：${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    } finally {
      set({ modelsLoading: false });
    }
  },

  pushStatus: (message, type) => {
    set(state => ({ status: { message, type, n: (state.status?.n ?? 0) + 1 } }));
  },

  clearStatus: () => {
    set({ status: null });
  },

  markSaved: key => {
    set(state => ({ savedTick: { ...state.savedTick, [key]: (state.savedTick[key] ?? 0) + 1 } }));
  },
}));
