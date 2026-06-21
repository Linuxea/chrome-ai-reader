/**
 * Tests for platform/ports.ts — typed wrappers over chrome.runtime.connect.
 *
 * Verifies that each openXxxPort helper opens a connection with the correct
 * port name (single source of truth for port-name constants).
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

const connectMock = vi.fn();
vi.stubGlobal('chrome', {
  runtime: { connect: connectMock },
});

import {
  openPort,
  openAIChatPort,
  openTTSPort,
  openTTSDownloadPort,
  openSuggestPort,
  openPodcastLLMPort,
  openPodcastAudioPort,
  openEmbeddingPort,
  openAnnotationPort,
} from '../../src/platform/ports';

describe('platform/ports', () => {
  beforeEach(() => {
    connectMock.mockClear();
  });

  it('openPort connects with the given name', () => {
    openPort('ai-chat');
    expect(connectMock).toHaveBeenCalledWith({ name: 'ai-chat' });
  });

  // Each convenience helper must use the canonical port name from PORT_NAMES.
  // This guards against typos when call sites reference port names by string.
  it.each([
    ['openAIChatPort', openAIChatPort, 'ai-chat'],
    ['openTTSPort', openTTSPort, 'tts'],
    ['openTTSDownloadPort', openTTSDownloadPort, 'tts-download'],
    ['openSuggestPort', openSuggestPort, 'suggest-questions'],
    ['openPodcastLLMPort', openPodcastLLMPort, 'podcast-llm'],
    ['openPodcastAudioPort', openPodcastAudioPort, 'podcast-audio'],
    ['openEmbeddingPort', openEmbeddingPort, 'embedding'],
    ['openAnnotationPort', openAnnotationPort, 'annotation'],
  ] as const)('%s connects with name %s', (_label, fn, expectedName) => {
    fn();
    expect(connectMock).toHaveBeenCalledWith({ name: expectedName });
  });
});
