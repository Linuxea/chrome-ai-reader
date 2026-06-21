/**
 * Deep annotation content module — barrel re-export.
 *
 * Formerly a 462-line god module, now split into focused sub-modules under
 * ./annotation/. This file re-exports every public symbol so existing
 * importers (content/index.ts, tests/content/annotation.test.ts) keep working
 * unchanged:
 *   - chunk-collector: collectChunks, buildFullArticle, MIN_CHUNK_LENGTH, CollectedChunk
 *   - quote-wrapper:   findAndWrap, MARK_CLASS
 *   - bubble-ui:       getBubbleHost, createIconFor, IconHandle
 *   - orchestrator:    handleStartAnnotation, handleClearAnnotation, resetAnnotationState
 *   - styles:          ANNOTATION_CSS, injectAnnotationCSS
 *
 * Spec: docs/superpowers/specs/2026-06-20-deep-annotation-design.md
 */

export {
  MIN_CHUNK_LENGTH,
  collectChunks,
  buildFullArticle,
  type CollectedChunk,
} from './annotation/chunk-collector';

export { findAndWrap, MARK_CLASS } from './annotation/quote-wrapper';

export { getBubbleHost, createIconFor, type IconHandle } from './annotation/bubble-ui';

export {
  handleStartAnnotation,
  handleClearAnnotation,
  resetAnnotationState,
} from './annotation/orchestrator';

export { ANNOTATION_CSS, injectAnnotationCSS } from './annotation/styles';
