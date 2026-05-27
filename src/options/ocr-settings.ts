const ocrApiKeyInput = document.getElementById('ocrApiKey') as HTMLInputElement;

export function initOcrSettings(): void {}

export function loadOcrValues(data: Record<string, unknown>): void { if (data.ocrApiKey) ocrApiKeyInput.value = data.ocrApiKey as string; }

export function collectOcrSaveData(): { set: Record<string, string>; remove: string[] } {
  const ocrApiKey = ocrApiKeyInput.value.trim();
  if (ocrApiKey) return { set: { ocrApiKey }, remove: [] };
  return { set: {}, remove: ['ocrApiKey'] };
}
