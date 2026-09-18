import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { defaultSettingsMiddleware, wrapLanguageModel } from 'ai';
import type { LanguageModel } from 'ai';

/** A concrete model instance (the ai-package `LanguageModel` union also allows bare model-name strings). */
export type ChatModelInstance = Exclude<LanguageModel, string>;

const DEFAULT_API_BASE = 'https://api.deepseek.com';

interface ChatConfig {
  apiKey?: string;
  apiBase?: string;
  modelName?: string;
}

/** Raw chat provider config as stored in chrome.storage.sync. */
export async function loadChatConfig(): Promise<ChatConfig> {
  return (await chrome.storage.sync.get(['apiKey', 'apiBase', 'modelName'])) as ChatConfig;
}

/**
 * Build an AI SDK chat model instance from the extension's chat provider
 * config. Returns null when apiKey or modelName is missing — callers
 * translate that into the port-level error messages the panel renders.
 */
export async function getChatModel(): Promise<ChatModelInstance | null> {
  const { apiKey, apiBase, modelName } = await loadChatConfig();
  if (!apiKey || !modelName) return null;

  const provider = createOpenAICompatible({
    name: 'chat-provider',
    baseURL: apiBase || DEFAULT_API_BASE,
    apiKey,
  });
  return provider.chatModel(modelName);
}

/**
 * Wrap a model so every call sends `response_format: {type:'json_object'}`
 * on the wire (the OpenAI-compatible JSON mode the podcast/outline callers
 * rely on). streamText/generateText do not expose responseFormat directly;
 * injecting it at the call-settings level keeps the wire behavior identical
 * to the previous hand-rolled fetch.
 */
export function withJsonMode(model: ChatModelInstance): ChatModelInstance {
  return wrapLanguageModel({
    model,
    middleware: defaultSettingsMiddleware({ settings: { responseFormat: { type: 'json' } } }),
  });
}
