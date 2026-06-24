import { t } from '../../shared/i18n.js';

let _modelStatusBar: HTMLElement;

export function initModelStatus(): void {
  _modelStatusBar = document.getElementById('modelStatusBar')!;

  chrome.storage.sync.get(['modelName'], (data) => {
    updateModelStatusBar(data.modelName as string | undefined);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.modelName) {
      updateModelStatusBar(changes.modelName.newValue as string);
    }
  });
}

export function updateModelStatusBar(name?: string): void {
  _modelStatusBar.textContent = t('sidebar.modelStatus') + (name || t('sidebar.modelNotConfigured'));
}
