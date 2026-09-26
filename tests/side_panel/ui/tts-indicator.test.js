import { vi, describe, it, expect, beforeEach } from 'vitest';
import { initTTSIndicator, renderTTSIndicator } from '../../../src/side_panel/ui/tts-indicator.js';

function mountIndicator() {
  document.body.innerHTML = `
    <div id="ttsIndicator" class="tts-indicator hidden">
      <span class="tts-indicator-icon"><svg></svg></span>
      <span class="tts-indicator-title"></span>
      <button class="tts-indicator-stop" type="button"></button>
    </div>`;
}

describe('TTS indicator (global cross-page control)', () => {
  beforeEach(() => {
    mountIndicator();
  });

  it('is hidden while nothing plays', () => {
    renderTTSIndicator({ playing: false, audioStarted: false });
    const root = document.getElementById('ttsIndicator');
    expect(root.classList.contains('hidden')).toBe(true);
    expect(root.classList.contains('is-waiting')).toBe(false);
  });

  it('shows the waiting (spinner) state before audio starts', () => {
    renderTTSIndicator({ playing: true, audioStarted: false });
    const root = document.getElementById('ttsIndicator');
    expect(root.classList.contains('hidden')).toBe(false);
    expect(root.classList.contains('is-waiting')).toBe(true);
  });

  it('shows the playing state once audio started', () => {
    renderTTSIndicator({ playing: true, audioStarted: true });
    const root = document.getElementById('ttsIndicator');
    expect(root.classList.contains('hidden')).toBe(false);
    expect(root.classList.contains('is-waiting')).toBe(false);
  });

  it('stop button calls the injected onStop handler', () => {
    const onStop = vi.fn();
    initTTSIndicator({ onStop });

    document.querySelector('.tts-indicator-stop').click();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('is a no-op without the root element', () => {
    document.body.innerHTML = '';
    expect(() => {
      initTTSIndicator({ onStop: vi.fn() });
      renderTTSIndicator({ playing: true, audioStarted: false });
    }).not.toThrow();
  });
});
