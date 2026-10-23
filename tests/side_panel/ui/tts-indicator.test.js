import { vi, describe, it, expect, beforeEach } from 'vitest';
import { initTTSIndicator, renderTTSIndicator, renderTTSProgress, renderTTSRate } from '../../../src/side_panel/ui/tts-indicator.js';

function mountIndicator() {
  document.body.innerHTML = `
    <div id="ttsIndicator" class="tts-indicator hidden">
      <span class="tts-indicator-icon"><svg></svg></span>
      <span class="tts-indicator-title"></span>
      <span id="ttsIndicatorProgress" class="tts-indicator-progress hidden"></span>
      <button class="tts-indicator-rate" id="ttsRateBtn" type="button">1.0×</button>
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
    initTTSIndicator({ onStop, onCycleRate: vi.fn() });

    document.querySelector('.tts-indicator-stop').click();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('rate button calls the injected onCycleRate handler', () => {
    const onCycleRate = vi.fn();
    initTTSIndicator({ onStop: vi.fn(), onCycleRate });

    document.querySelector('.tts-indicator-rate').click();
    expect(onCycleRate).toHaveBeenCalledTimes(1);
  });

  it('is a no-op without the root element', () => {
    document.body.innerHTML = '';
    expect(() => {
      initTTSIndicator({ onStop: vi.fn(), onCycleRate: vi.fn() });
      renderTTSIndicator({ playing: true, audioStarted: false });
    }).not.toThrow();
  });
});

describe('TTS indicator progress', () => {
  beforeEach(() => {
    mountIndicator();
  });

  it('renders m:ss / m:ss against the buffered end', () => {
    renderTTSProgress(65, 125);
    const el = document.getElementById('ttsIndicatorProgress');
    expect(el.classList.contains('hidden')).toBe(false);
    expect(el.textContent).toBe('1:05 / 2:05');
  });

  it('hides for zero/invalid ends (nothing buffered yet)', () => {
    renderTTSProgress(0, 0);
    const el = document.getElementById('ttsIndicatorProgress');
    expect(el.classList.contains('hidden')).toBe(true);
    expect(el.textContent).toBe('');

    renderTTSProgress(10, NaN);
    expect(el.classList.contains('hidden')).toBe(true);
  });

  it('clears the progress when playback stops', () => {
    renderTTSProgress(5, 30);
    renderTTSIndicator({ playing: false, audioStarted: false });
    expect(document.getElementById('ttsIndicatorProgress').textContent).toBe('');
  });
});

describe('TTS indicator rate label', () => {
  it('renders the active rate step', () => {
    mountIndicator();
    renderTTSRate(1.5);
    expect(document.getElementById('ttsRateBtn').textContent).toBe('1.5×');
  });

  it('is a no-op without the button', () => {
    document.body.innerHTML = '';
    expect(() => renderTTSRate(2)).not.toThrow();
  });
});
