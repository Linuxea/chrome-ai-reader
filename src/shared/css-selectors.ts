/**
 * Centralized CSS class selectors used across the codebase.
 * Changing a class name here updates all references automatically.
 */
export const CSS = {
  // Message elements
  MESSAGE: '.message',
  MESSAGE_USER: '.message-user',
  MESSAGE_AI: '.message-ai',
  MESSAGE_ERROR: '.message-error',

  // TTS
  TTS_BTN: '.tts-btn',
  TTS_PLAYING: '.tts-playing',
  TTS_LOADING: '.tts-loading',
  TTS_DOWNLOAD_BTN: '.tts-download-btn',

  // Image/OCR
  IMAGE_PREVIEW_ITEM: '.image-preview-item',
  IMAGE_PREVIEW_ERROR: '.image-preview-item.error',
  IMAGE_STATUS: '.image-status',
  IMAGE_THUMB: '.image-thumb',

  // Outline
  OUTLINE_CONTAINER: '.outline-container',
  OUTLINE_NODE: '.outline-node',

  // Podcast
  PODCAST_CARD: '.podcast-card',
  PODCAST_PLAY_BTN: '.podcast-play-btn',

  // Chart
  CHART_CARD: '.chart-card',

  // Common
  WELCOME_MSG: '.welcome-msg',
  THINKING_CONTENT: '.thinking-response-content',
  SUGGEST_QUESTIONS: '.suggest-questions',
  AI_ACTION_BTN: '.ai-action-btn',
} as const;
