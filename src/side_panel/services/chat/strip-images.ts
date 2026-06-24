import type { ChatMessage } from '../../../shared/types';

/**
 * Strip `image_url` blocks from a message's `content` array, keeping only the
 * text blocks joined by newlines. String content is returned unchanged.
 *
 * Memory `conversationHistory` retains original array-form messages so
 * subsequent rounds can still send image_url to the model. Only the persisted
 * (storage) form is stripped — images are memory-only to avoid quota blowup.
 * `hadImages` is preserved so reload-time rendering can show "image lost".
 */
export function stripImagesForPersistence(msg: ChatMessage): ChatMessage {
  if (typeof msg.content === 'string') return msg;
  const textParts = msg.content.filter(p => p.type === 'text');
  const text = textParts.map(p => p.text).join('\n');
  return { ...msg, content: text, hadImages: msg.hadImages };
}
