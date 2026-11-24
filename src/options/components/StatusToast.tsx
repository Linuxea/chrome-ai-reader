/**
 * StatusToast — the options page's transient status line (model list
 * loaded, save failed, cache cleared…). Replaces the legacy fixed #status
 * element; auto-hides after 3s, same window as before.
 */
import { useEffect } from 'react';
import { useSettingsStore } from '../settings-store';

const TOAST_MS = 3000;

export function StatusToast() {
  const status = useSettingsStore(s => s.status);
  const clearStatus = useSettingsStore(s => s.clearStatus);

  useEffect(() => {
    if (!status) return;
    const id = setTimeout(clearStatus, TOAST_MS);
    return () => clearTimeout(id);
  }, [status, clearStatus]);

  if (!status) return null;
  return (
    <div className={`status-toast ${status.type}`} role="status" key={status.n}>
      {status.message}
    </div>
  );
}
