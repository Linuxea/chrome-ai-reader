import type { ModelMessage } from 'ai';
import type { AssistantContent, ImagePart, TextPart, ToolCallPart, ToolResultPart } from 'ai';
import type { ChatMessage, MessageContentPart, ToolCall } from '../../shared/types';

/**
 * Conversions between the extension's ChatMessage wire format (OpenAI
 * chat-completions style, what the panel persists and sends over the port)
 * and the AI SDK's ModelMessage format.
 *
 * Differences that require mapping:
 *  - images:      wire `{type:'image_url', image_url:{url}}`  → SDK `{type:'image', image}`
 *  - tool calls:  wire `assistant.tool_calls[{id,name,arguments:string}]`
 *                 → SDK assistant content parts `{type:'tool-call', toolCallId, toolName, input}`
 *  - tool result: wire `{role:'tool', tool_call_id, name, content}`
 *                 → SDK `{role:'tool', content:[{type:'tool-result', toolCallId, toolName, output}]}`
 */

type UserPart = TextPart | ImagePart;

function toUserPart(part: MessageContentPart): UserPart {
  if (part.type === 'image_url') return { type: 'image', image: part.image_url.url };
  return { type: 'text', text: part.text };
}

function toAssistantParts(m: ChatMessage): AssistantContent {
  if (!m.tool_calls || m.tool_calls.length === 0) return typeof m.content === 'string' ? m.content : '';
  const parts: (TextPart | ToolCallPart)[] = [];
  if (typeof m.content === 'string' && m.content) parts.push({ type: 'text', text: m.content });
  for (const tc of m.tool_calls) {
    let input: unknown;
    try {
      input = JSON.parse(tc.arguments);
    } catch {
      input = {};
    }
    parts.push({ type: 'tool-call', toolCallId: tc.id, toolName: tc.name, input });
  }
  return parts;
}

function toToolMessage(m: ChatMessage): ModelMessage {
  const part: ToolResultPart = {
    type: 'tool-result',
    toolCallId: m.tool_call_id || '',
    toolName: m.name || 'unknown',
    output: { type: 'text', value: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) },
  };
  return { role: 'tool', content: [part] };
}

/** ChatMessage[] (wire) → ModelMessage[] (AI SDK). Pure and total. */
export function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.map((m): ModelMessage => {
    if (m.role === 'user' && Array.isArray(m.content)) {
      return { role: 'user', content: m.content.map(toUserPart) };
    }
    if (m.role === 'assistant') {
      return { role: 'assistant', content: toAssistantParts(m) };
    }
    if (m.role === 'tool') {
      return toToolMessage(m);
    }
    // system / plain user / plain assistant pass through with their own role
    return {
      role: m.role as 'system' | 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : '',
    };
  });
}

/**
 * ModelMessage[] (AI SDK response.messages — assistant/tool turns generated
 * during an agent run) → ChatMessage[] for the panel's conversationHistory.
 * The reverse of toModelMessages for the message kinds the model can emit.
 */
export function fromModelMessages(messages: ModelMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'assistant') {
      let text = '';
      const toolCalls: ToolCall[] = [];
      const parts = Array.isArray(m.content) ? m.content : [];
      for (const p of parts) {
        if (p.type === 'text') text += p.text;
        else if (p.type === 'tool-call') {
          toolCalls.push({
            id: p.toolCallId,
            name: p.toolName,
            arguments: JSON.stringify(p.input ?? {}),
          });
        }
      }
      out.push({
        role: 'assistant',
        content: text,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else if (m.role === 'tool') {
      const parts = Array.isArray(m.content) ? m.content : [];
      for (const p of parts) {
        if (p.type !== 'tool-result') continue;
        out.push({
          role: 'tool',
          tool_call_id: p.toolCallId,
          name: p.toolName,
          content:
            p.output?.type === 'text' || p.output?.type === 'error-text' ? p.output.value
            : p.output?.type === 'json' || p.output?.type === 'error-json' ? JSON.stringify(p.output.value)
            : '',
        });
      }
    }
    // system/user messages never appear in response.messages — skip anything else
  }
  return out;
}
