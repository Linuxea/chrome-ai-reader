import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AppWindow, Check } from 'lucide-react';
import { useComposerStore } from '@/panel/stores/composer-store';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { MAX_ATTACHED_TABS } from '@/shared/constants';
import { t } from '@/shared/i18n.js';

interface TabInfo { id: number; title: string; url: string }

/**
 * F4 tab picker — attach other open tabs as context (read fresh at send
 * time). Excludes the active tab (it IS the page context).
 */
export function TabPicker({ onClose }: { onClose: () => void }) {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const attached = useComposerStore(s => s.tabs);
  const toggleAttachedTab = useComposerStore(s => s.toggleAttachedTab);
  const activeTabId = useTabsStore(s => s.activeTabId);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void chrome.tabs.query({ currentWindow: true }).then(all => {
      setTabs(all.filter(t => t.id !== activeTabId && t.url?.startsWith('http')).map(t => ({ id: t.id!, title: t.title || t.url || '', url: t.url || '' })));
    }).catch(() => setTabs([]));
  }, [activeTabId]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return (
    <AnimatePresence>
      <motion.div
        className="tab-picker"
        ref={ref}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-label={t('sidebar.attachTabs')}
      >
        <div className="tab-picker-title">{t('sidebar.attachTabs')}</div>
        <div className="tab-picker-list">
          {tabs.length === 0 && <div className="command-empty">{t('multitab.none')}</div>}
          {tabs.map(tab => {
            const isAttached = attached.some(a => a.id === tab.id);
            return (
              <button
                key={tab.id}
                className={`tab-picker-item${isAttached ? ' attached' : ''}`}
                onClick={() => {
                  if (!toggleAttachedTab(tab) && !isAttached) {
                    // The cap (4) was hit — keep the picker open for a swap.
                  }
                }}
              >
                <AppWindow size={13} className="tab-picker-icon" />
                <span className="tab-picker-name">{tab.title}</span>
                {isAttached && <Check size={13} className="tab-picker-check" />}
              </button>
            );
          })}
        </div>
        <div className="command-hint">{attached.length}/{MAX_ATTACHED_TABS}</div>
      </motion.div>
    </AnimatePresence>
  );
}
