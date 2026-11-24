/**
 * TTS section — Volcengine credentials + playback toggles + the segment
 * audio cache (IndexedDB, shared with the panel's player and downloads).
 */
import { useCallback, useEffect, useState } from 'react';
import { t } from '@/shared/i18n.js';
import { formatBytes } from '@/shared/format';
import { clearTtsCache, estimateTtsCacheBytes } from '@/shared/tts-cache';
import { useSettingsStore } from '../settings-store';
import { SectionCard } from '../components/SectionCard';
import { TextField } from '../components/TextField';
import { ToggleRow } from '../components/ToggleRow';

export function TtsSection() {
  useSettingsStore(s => s.lang);
  const ttsAppId = useSettingsStore(s => s.ttsAppId);
  const ttsAccessKey = useSettingsStore(s => s.ttsAccessKey);
  const ttsResourceId = useSettingsStore(s => s.ttsResourceId);
  const podcastResourceId = useSettingsStore(s => s.podcastResourceId);
  const ttsSpeaker = useSettingsStore(s => s.ttsSpeaker);
  const ttsAutoPlay = useSettingsStore(s => s.ttsAutoPlay);
  const podcastDirect = useSettingsStore(s => s.podcastDirect);
  const setText = useSettingsStore(s => s.setText);
  const blurText = useSettingsStore(s => s.blurText);
  const setToggle = useSettingsStore(s => s.setToggle);

  const [cacheSize, setCacheSize] = useState<string>('–');
  const [clearing, setClearing] = useState(false);

  const refreshCacheSize = useCallback(async () => {
    try {
      setCacheSize(formatBytes(await estimateTtsCacheBytes()));
    } catch {
      setCacheSize('–');
    }
  }, []);

  useEffect(() => {
    void refreshCacheSize();
  }, [refreshCacheSize]);

  const onClearCache = async () => {
    setClearing(true);
    try {
      await clearTtsCache();
      await refreshCacheSize();
      useSettingsStore.getState().pushStatus(t('status.ttsCacheCleared'), 'success');
    } catch {
      useSettingsStore.getState().pushStatus(t('status.ttsCacheCleared'), 'error');
    } finally {
      setClearing(false);
    }
  };

  return (
    <SectionCard title={t('settings.tts')}>
      <TextField
        label={t('settings.tts.appId')}
        value={ttsAppId}
        onChange={v => setText('ttsAppId', v)}
        onBlur={() => blurText('ttsAppId')}
        placeholder={t('settings.tts.appId.ph')}
        savedKey="ttsAppId"
      />
      <TextField
        label={t('settings.tts.accessKey')}
        value={ttsAccessKey}
        onChange={v => setText('ttsAccessKey', v)}
        onBlur={() => blurText('ttsAccessKey')}
        placeholder={t('settings.tts.accessKey.ph')}
        password
        savedKey="ttsAccessKey"
      />
      <TextField
        label={t('settings.tts.resourceId')}
        value={ttsResourceId}
        onChange={v => setText('ttsResourceId', v)}
        onBlur={() => blurText('ttsResourceId')}
        placeholder={t('settings.tts.resourceId.ph')}
        hint={t('settings.tts.resourceId.hint')}
        savedKey="ttsResourceId"
      />
      <TextField
        label={t('settings.podcast.resourceId')}
        value={podcastResourceId}
        onChange={v => setText('podcastResourceId', v)}
        onBlur={() => blurText('podcastResourceId')}
        placeholder={t('settings.podcast.resourceId.ph')}
        hint={t('settings.podcast.resourceId.hint')}
        savedKey="podcastResourceId"
      />
      <TextField
        label={t('settings.tts.speaker')}
        value={ttsSpeaker}
        onChange={v => setText('ttsSpeaker', v)}
        onBlur={() => blurText('ttsSpeaker')}
        placeholder={t('settings.tts.speaker.ph')}
        hint={<span dangerouslySetInnerHTML={{ __html: t('settings.tts.speaker.hint') }} />}
        savedKey="ttsSpeaker"
      />

      <ToggleRow
        label={t('settings.tts.autoPlay')}
        checked={ttsAutoPlay}
        onChange={v => setToggle('ttsAutoPlay', v)}
      />
      <ToggleRow
        label={t('settings.podcast.direct')}
        checked={podcastDirect}
        onChange={v => setToggle('podcastDirect', v)}
        hint={t('settings.podcast.direct.hint')}
      />

      <div className="form-group">
        <label className="field-label">
          <span>{t('settings.tts.cache')}</span>
        </label>
        <p className="field-hint">{cacheSize}</p>
        <div>
          <button type="button" className="refresh-btn" onClick={() => void onClearCache()} disabled={clearing}>
            {t('settings.tts.cache.clear')}
          </button>
        </div>
        <p className="field-hint">{t('settings.tts.cache.hint')}</p>
      </div>
    </SectionCard>
  );
}
