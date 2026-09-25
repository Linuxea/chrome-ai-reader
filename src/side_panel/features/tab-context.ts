/**
 * F4 — multi-tab questions: attach other open tabs to the next message.
 * The picker lists this window's tabs; attached tabs show as chips above the
 * input; the composer owns the selection and sendToAI reads each tab fresh.
 */

import { t } from '../../shared/i18n.js';
import * as state from '../state';
import { showToast } from '../ui/toast';
import {
  toggleAttachedTab, detachTab, getAttachedTabs, onAttachedTabsChange,
  MAX_ATTACHED_TABS, type AttachedTab,
} from '../services/composer';

let _picker: HTMLElement;
let _chipBar: HTMLElement;

export function initTabContext({ button, picker, chipBar }: { button: HTMLElement; picker: HTMLElement; chipBar: HTMLElement }): void {
  _picker = picker;
  _chipBar = chipBar;
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_picker.classList.contains('hidden')) void openPicker(); else closePicker();
  });
  document.addEventListener('click', (e) => {
    if (!_picker.contains(e.target as Node)) closePicker();
  });
  onAttachedTabsChange(renderChips);
  renderChips(getAttachedTabs());
}

function closePicker(): void {
  _picker.classList.add('hidden');
}

/** Tabs that can be attached: this window, not the active one, web pages only. */
export async function candidateTabs(): Promise<AttachedTab[]> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const active = state.getActiveTabId();
  return tabs
    .filter((tab) => tab.id != null && tab.id !== active && /^https?:/.test(tab.url ?? ''))
    .map((tab) => ({ id: tab.id!, title: tab.title || tab.url || '', url: tab.url || '' }));
}

async function openPicker(): Promise<void> {
  const tabs = await candidateTabs();
  _picker.innerHTML = '';
  const heading = document.createElement('div');
  heading.className = 'tab-picker-title';
  heading.textContent = t('tabs.pickerTitle', { max: String(MAX_ATTACHED_TABS) });
  _picker.appendChild(heading);
  if (!tabs.length) {
    const empty = document.createElement('div');
    empty.className = 'tab-picker-empty';
    empty.textContent = t('tabs.none');
    _picker.appendChild(empty);
  }
  const attached = new Set(getAttachedTabs().map((a) => a.id));
  for (const tab of tabs) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'tab-picker-item' + (attached.has(tab.id) ? ' selected' : '');
    row.textContent = tab.title;
    row.title = tab.url;
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!toggleAttachedTab(tab)) { showToast(t('tabs.limit', { max: String(MAX_ATTACHED_TABS) }), 2500); return; }
      row.classList.toggle('selected');
    });
    _picker.appendChild(row);
  }
  _picker.classList.remove('hidden');
}

function renderChips(tabs: AttachedTab[]): void {
  _chipBar.innerHTML = '';
  _chipBar.classList.toggle('hidden', tabs.length === 0);
  for (const tab of tabs) {
    const chip = document.createElement('span');
    chip.className = 'tab-chip';
    chip.title = tab.url;
    const label = document.createElement('span');
    label.textContent = `📄 ${tab.title}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'tab-chip-remove';
    remove.textContent = '✕';
    remove.setAttribute('aria-label', t('tabs.remove'));
    remove.addEventListener('click', () => detachTab(tab.id));
    chip.append(label, remove);
    _chipBar.appendChild(chip);
  }
}
