/**
 * Central JSDoc type definitions for the chrome-ai-reader project.
 *
 * These types serve as a living contract for state shapes and data structures,
 * and will be the foundation for a future TypeScript migration (Phase 5).
 *
 * Usage in other modules:
 *   // At the top of your file, import for JSDoc IntelliSense:
 *   import './shared/types.js';  // side-effect import makes typedefs available
 *
 *   /** @type {TabState} * /
 *   const tab = getActiveTabState();
 */

/**
 * A single chat message in the conversation history.
 *
 * @typedef {Object} ChatMessage
 * @property {'system'|'user'|'assistant'} role - Who sent the message
 * @property {string} content - The text content of the message
 * @property {string} [type] - Optional discriminator (e.g. 'image' for multimodal)
 */

/**
 * State object for a single browser tab. Created by `createFreshTabState()`
 * and stored per-tab in memory + chrome.storage.session.
 *
 * @typedef {Object} TabState
 * @property {string} pageContent - Extracted readable text of the current page
 * @property {string} pageTitle - Title of the current page
 * @property {string} pageExcerpt - Short excerpt / meta description
 * @property {ChatMessage[]} conversationHistory - Chat message history
 * @property {string|null} currentChatId - ID of the active chat session
 * @property {string} selectedText - Currently selected text on the page
 * @property {boolean} isGenerating - Whether an AI response is streaming
 * @property {boolean} isPodcastGenerating - Whether a podcast is being generated
 * @property {boolean} isChartGenerating - Whether a chart is being generated
 * @property {Array<Object>} detectedCharts - Charts detected on the page
 * @property {number} ocrRunning - OCR task counter (0 = idle)
 * @property {Array<{index: number, fileName: string, text: string}>} ocrResults - OCR results per image
 * @property {number} imageIndex - Current image index for OCR scanning
 */

/**
 * A stored page record with its embedding vector.
 *
 * @typedef {Object} PageRecord
 * @property {string} id - Unique identifier (crypto.randomUUID)
 * @property {string} url - Page URL
 * @property {string} title - Page title
 * @property {string} excerpt - Short excerpt (max 200 chars)
 * @property {number[]} embedding - Embedding vector
 * @property {number} timestamp - Reading time (Date.now())
 */

/**
 * A page record paired with its similarity score.
 *
 * @typedef {Object} PageRelation
 * @property {PageRecord} record - The related page record
 * @property {number} similarity - Cosine similarity (0-1)
 */
