/**
 * Shared MediaSource + SourceBuffer streaming audio player.
 * Used by both TTS player and podcast audio to avoid duplicating
 * ~80 lines of MediaSource setup, chunk buffering, and cleanup logic.
 */

interface AudioStreamOptions {
  mimeType?: string;
  onFirstChunkPlayed?: () => void;
  onEnded?: () => void;
}

export interface AudioStreamHandle {
  /** Append a base64-encoded audio chunk */
  appendChunk(base64Data: string): void;
  /** Signal that all chunks have been sent — ends the stream */
  finish(): void;
  /** Clean up all resources */
  destroy(): void;
  /** The underlying audio element */
  audioEl: HTMLAudioElement;
}

export function createAudioStream(options: AudioStreamOptions = {}): AudioStreamHandle {
  const mimeType = options.mimeType || 'audio/mpeg';

  let chunkQueue: ArrayBuffer[] = [];
  let bufferAppending = false;
  let destroyed = false;

  const ms = new MediaSource();
  const audio = new Audio();
  audio.src = URL.createObjectURL(ms);

  let sourceBuffer: SourceBuffer | null = null;
  let started = false;

  ms.addEventListener('sourceopen', () => {
    if (destroyed || ms.sourceBuffers.length > 0) return;
    sourceBuffer = ms.addSourceBuffer(mimeType);

    sourceBuffer.addEventListener('updateend', () => {
      bufferAppending = false;
      if (destroyed) return;

      if (!started && audio.paused && sourceBuffer!.buffered.length > 0) {
        started = true;
        audio.play().then(() => {
          options.onFirstChunkPlayed?.();
        }).catch(() => {});
      }
      appendNext();
    });
  });

  audio.addEventListener('ended', () => {
    options.onEnded?.();
  });

  function appendNext(): void {
    if (!sourceBuffer || bufferAppending || chunkQueue.length === 0) return;
    bufferAppending = true;
    const chunk = chunkQueue.shift()!;
    try {
      sourceBuffer.appendBuffer(chunk);
    } catch (e) {
      console.error('[AudioStream] appendBuffer error:', e);
      bufferAppending = false;
    }
  }

  function decodeBase64(base64Data: string): ArrayBuffer {
    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes.buffer;
  }

  return {
    audioEl: audio,

    appendChunk(base64Data: string): void {
      if (destroyed) return;
      chunkQueue.push(decodeBase64(base64Data));
      appendNext();
    },

    finish(): void {
      if (destroyed) return;
      const finishStream = () => {
        if (sourceBuffer && !bufferAppending) {
          try { safeEndOfStream(ms); } catch { /* cleanup */ }
        }
      };
      if (bufferAppending) {
        const handler = () => { finishStream(); sourceBuffer?.removeEventListener('updateend', handler); };
        sourceBuffer?.addEventListener('updateend', handler);
      } else {
        finishStream();
      }
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      audio.pause();
      audio.src = '';
      try { safeEndOfStream(ms); } catch { /* cleanup */ }
      chunkQueue = [];
      sourceBuffer = null;
    },
  };
}

// Inline safeEndOfStream to avoid circular dependency with chrome-helpers
function safeEndOfStream(ms: MediaSource): void {
  if (ms.readyState === 'open') {
    try { ms.endOfStream(); } catch { /* network error or invalid state */ }
  }
}
