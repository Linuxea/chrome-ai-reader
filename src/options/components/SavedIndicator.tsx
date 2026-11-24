/**
 * SavedIndicator — the light ✓ next to a field after its value landed in
 * storage (immediate-save feedback; D-2). The store bumps a per-key
 * counter on every persist; the hook turns the latest bump into a 1s
 * flash.
 */
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { useSettingsStore } from '../settings-store';

export function useSavedIndicator(key?: string): boolean {
  const tick = useSettingsStore(s => (key ? s.savedTick[key] : undefined));
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (tick === undefined) return;
    setShow(true);
    const id = setTimeout(() => setShow(false), 1000);
    return () => clearTimeout(id);
  }, [tick]);

  return show;
}

export function SavedIndicator({ savedKey }: { savedKey?: string }) {
  const show = useSavedIndicator(savedKey);
  return (
    <span className={`saved-indicator ${show ? 'show' : ''}`} aria-hidden>
      <Check size={13} />
    </span>
  );
}
