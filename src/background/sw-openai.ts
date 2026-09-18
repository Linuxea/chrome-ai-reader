import { streamText, APICallError, stepCountIs } from 'ai';
import { safePostMessage } from './sw-utils';
import { getChatModel, loadChatConfig, withJsonMode } from './llm/provider';
import { toModelMessages, fromModelMessages } from './llm/messages';
import { getEnabledTools } from './llm/tools';
import { fetchEmbeddingVector } from './llm/embedding';
import type { ChatMessage } from '../shared/types';

interface StreamOptions {
  response_format?: Record<string, unknown>;
  temperature?: number;
}

const DEFAULT_TEMPERATURE = 0.7;

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

/** Human-readable port error text; falls back to the HTTP status when the body carries no message. */
function formatStreamError(e: unknown): string {
  if (e instanceof APICallError) return e.message || `API request failed (${e.statusCode})`;
  return e instanceof Error ? e.message : String(e);
}

/**
 * Single error exit for the agent path: detects "provider has no function
 * calling" 400s and surfaces the dedicated errorKey instead of raw text.
 */
function postAgentError(port: chrome.runtime.Port, e: unknown): void {
  if (e instanceof APICallError && e.statusCode === 400 && /tool|function/i.test(e.message)) {
    // Keep the provider's message alongside the errorKey — the heuristic can
    // misclassify unrelated 400s, and the real cause must stay visible.
    safePostMessage(port, { type: 'error', error: e.message, errorKey: 'error.toolsNotSupported' });
    return;
  }
  safePostMessage(port, { type: 'error', error: formatStreamError(e) });
}

/**
 * Single streaming pipeline for every chat-completions caller
 * (ai-chat, suggest-questions, podcast-llm), built on the Vercel AI SDK.
 *
 * The delta-parse point lives here and only here: the onChunk callback maps
 * SDK stream parts onto the port's StreamMessage protocol. ai@7 field note:
 * text/reasoning deltas carry their payload in `.text` (NOT `.textDelta`).
 */
interface SdkStreamArgs {
  messages: ChatMessage[];
  port: chrome.runtime.Port;
  temperature?: number;
  jsonMode?: boolean;
  forwardThinking?: boolean;
}

async function streamViaSdk({
  messages,
  port,
  temperature,
  jsonMode,
  forwardThinking = true,
}: SdkStreamArgs): Promise<void> {
  const model = await getChatModel();
  if (!model) return; // callers pre-check config and post specific errorKeys

  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());

  // Stream errors do NOT reject textStream in ai@7 — they surface via onError
  // and the stream just ends. Capture here so done is not posted after errors.
  let streamError: Error | undefined;

  try {
    const result = streamText({
      model: jsonMode ? withJsonMode(model) : model,
      messages: toModelMessages(messages),
      temperature: temperature ?? DEFAULT_TEMPERATURE,
      // The previous hand-rolled fetch never retried; keep parity (the SDK
      // defaults to 2 retries with exponential backoff).
      maxRetries: 0,
      // The panel's conversation history carries a leading system message;
      // ai@7 requires opt-in to pass system roles through `messages`.
      allowSystemInMessages: true,
      abortSignal: controller.signal,
      onError: ({ error }) => {
        streamError = error instanceof Error ? error : new Error(String(error));
      },
      onChunk: ({ chunk }) => {
        if (chunk.type === 'text-delta') {
          safePostMessage(port, { type: 'chunk', content: chunk.text });
        } else if (forwardThinking && chunk.type === 'reasoning-delta') {
          safePostMessage(port, { type: 'thinking', content: chunk.text });
        }
      },
    });
    // Drive the stream to completion; onChunk forwards every part.
    for await (const _ of result.textStream) {
      void _;
    }
    if (streamError) {
      safePostMessage(port, { type: "error", error: formatStreamError(streamError) });
      return;
    }
    safePostMessage(port, { type: 'done' });
  } catch (e: unknown) {
    if (isAbortError(e)) return; // port disconnected; nothing to report
    if (streamError) {
      safePostMessage(port, { type: "error", error: formatStreamError(streamError) });
      return;
    }
    safePostMessage(port, { type: "error", error: formatStreamError(e) });
  }
}

export async function callOpenAI(messages: ChatMessage[], port: chrome.runtime.Port, options?: StreamOptions): Promise<void> {
  const { apiKey, modelName } = await loadChatConfig();
  if (!apiKey) { safePostMessage(port, { type: 'error', errorKey: 'error.noApiKey' }); return; }
  if (!modelName) { safePostMessage(port, { type: 'error', errorKey: 'error.noModelName' }); return; }

  await streamViaSdk({
    messages,
    port,
    temperature: options?.temperature,
    jsonMode: options?.response_format?.type === 'json_object',
  });
}

export async function callSuggestQuestions(messages: ChatMessage[], port: chrome.runtime.Port): Promise<void> {
  const { apiKey, modelName } = await loadChatConfig();
  if (!apiKey) { safePostMessage(port, { type: 'error', errorKey: 'error.noApiKeySuggest' }); return; }
  if (!modelName) { safePostMessage(port, { type: 'error', errorKey: 'error.noModelName' }); return; }

  await streamViaSdk({
    messages,
    port,
    temperature: 0.8,
    forwardThinking: false,
  });
}

const MAX_AGENT_STEPS = 8;

/**
 * Agent mode: same streaming pipeline, plus the enabled tool set. The SDK's
 * stopWhen guard bounds the loop; tool execute()s run in this worker. On a
 * clean finish the authoritative assistant/tool message sequence rides on
 * `done.messages` so the panel persists the exchange without reconstructing
 * it from UI events.
 */
export async function callAgent(messages: ChatMessage[], port: chrome.runtime.Port, enabledTools?: string[]): Promise<void> {
  const { apiKey, modelName } = await loadChatConfig();
  if (!apiKey) { safePostMessage(port, { type: 'error', errorKey: 'error.noApiKey' }); return; }
  if (!modelName) { safePostMessage(port, { type: 'error', errorKey: 'error.noModelName' }); return; }

  const tools = getEnabledTools(enabledTools);

  // Agent mode with every tool disabled behaves as plain streaming chat.
  if (Object.keys(tools).length === 0) {
    await streamViaSdk({ messages, port });
    return;
  }

  const model = await getChatModel();
  if (!model) return; // pre-checked above; defensive

  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());

  let streamError: Error | undefined;

  try {
    const result = streamText({
      model,
      messages: toModelMessages(messages),
      tools,
      stopWhen: stepCountIs(MAX_AGENT_STEPS),
      temperature: DEFAULT_TEMPERATURE,
      maxRetries: 0,
      allowSystemInMessages: true,
      abortSignal: controller.signal,
      onError: ({ error }) => {
        streamError = error instanceof Error ? error : new Error(String(error));
      },
      onChunk: ({ chunk }) => {
        if (chunk.type === 'text-delta') {
          safePostMessage(port, { type: 'chunk', content: chunk.text });
        } else if (chunk.type === 'reasoning-delta') {
          safePostMessage(port, { type: 'thinking', content: chunk.text });
        } else if (chunk.type === 'tool-call') {
          safePostMessage(port, { type: 'tool_call', id: chunk.toolCallId, name: chunk.toolName, input: chunk.input });
        } else if (chunk.type === 'tool-result') {
          const output = chunk.output;
          safePostMessage(port, {
            type: 'tool_result',
            id: chunk.toolCallId,
            output: typeof output === 'string' ? output : JSON.stringify(output),
          });
        }
      },
    });
    for await (const _ of result.textStream) {
      void _;
    }
    if (streamError) {
      postAgentError(port, streamError);
      return;
    }
    const finished = await result;
    const responseMessages = await finished.responseMessages;
    safePostMessage(port, { type: 'done', messages: fromModelMessages(responseMessages) });
  } catch (e: unknown) {
    if (isAbortError(e)) return; // port disconnected; nothing to report
    postAgentError(port, e);
  }
}

export async function callEmbedding(text: string, port: chrome.runtime.Port): Promise<void> {
  // Kept on raw fetch (not the AI SDK): separate config, stable.
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());

  try {
    const embedding = await fetchEmbeddingVector(text, controller.signal);
    safePostMessage(port, { type: 'embedding', embedding });
  } catch (e: unknown) {
    if (isAbortError(e)) return; // port disconnected; nothing to report
    const message = (e as Error).message;
    const errorKey =
      message === 'embedding-not-configured' ? 'error.embeddingNotConfigured'
      : message === 'empty-embedding' ? 'error.emptyEmbedding'
      : 'error.embeddingRequestFailed';
    safePostMessage(port, { type: 'error', error: message === 'embedding-not-configured' || message === 'empty-embedding' ? undefined : message, errorKey });
  }
}
