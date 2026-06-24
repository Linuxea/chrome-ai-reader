// The podcast system prompt lives in src/shared/prompts.ts ('podcast.system').
// It is intentionally zh-only because the TTS voice pipeline (SPEAKER_MAP
// below) targets Chinese voices.

const SPEAKER_MAP: Record<string, string> = {
  'A': 'zh_male_dayixiansheng_v2_saturn_bigtts',
  'B': 'zh_female_mizaitongxue_v2_saturn_bigtts',
};
const DEFAULT_SPEAKER = 'zh_female_mizaitongxue_v2_saturn_bigtts';
const MAX_CHUNK_QUEUE_SIZE = 50;

export { SPEAKER_MAP, DEFAULT_SPEAKER, MAX_CHUNK_QUEUE_SIZE };
