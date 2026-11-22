import { AnimatePresence, motion } from 'motion/react';
import { useUIStore } from '@/panel/stores/ui-store';

/** Floating toast stack (auto-dismiss lives in the store). */
export function Toasts() {
  const toasts = useUIStore(s => s.toasts);
  return (
    <div className="toast-stack" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className={`toast toast-${toast.kind}`}
          >
            {toast.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
