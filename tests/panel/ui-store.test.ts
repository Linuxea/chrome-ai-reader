import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useUIStore } from '@/panel/stores/ui-store';

describe('ui-store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useUIStore.setState({ sheet: null, toasts: [], commandPopup: { open: false, query: '', highlighted: 0 } });
  });

  it('sheet open/close', () => {
    useUIStore.getState().openSheet('history');
    expect(useUIStore.getState().sheet).toBe('history');
    useUIStore.getState().openSheet('notes');
    expect(useUIStore.getState().sheet).toBe('notes');
    useUIStore.getState().closeSheet();
    expect(useUIStore.getState().sheet).toBeNull();
  });

  it('command popup: open resets, query resets highlight, highlight requires open', () => {
    const s = useUIStore.getState();
    s.openCommandPopup();
    s.setCommandHighlight(3);
    s.setCommandQuery('/su');
    expect(useUIStore.getState().commandPopup).toEqual({ open: true, query: '/su', highlighted: 0 });
    s.closeCommandPopup();
    s.setCommandHighlight(2); // no-op when closed
    expect(useUIStore.getState().commandPopup.open).toBe(false);
  });

  it('toasts auto-dismiss after 3s and can be dismissed early', () => {
    const s = useUIStore.getState();
    s.pushToast('working…');
    s.pushToast('failed', 'error');
    expect(useUIStore.getState().toasts.map(t => t.message)).toEqual(['working…', 'failed']);
    const first = useUIStore.getState().toasts[0]!;
    s.dismissToast(first.id);
    expect(useUIStore.getState().toasts.map(t => t.message)).toEqual(['failed']);
    vi.advanceTimersByTime(3000);
    expect(useUIStore.getState().toasts).toHaveLength(0);
  });
});
