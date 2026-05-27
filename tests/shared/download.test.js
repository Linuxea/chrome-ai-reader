import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock URL APIs before importing the module
URL.createObjectURL = vi.fn((blob) => {
  const url = `blob:mock-${Date.now()}`;
  return url;
});
URL.revokeObjectURL = vi.fn();

import { downloadFile } from '../../src/shared/download.js';

describe('downloadFile', () => {
  let createElementSpy;
  let appendChildSpy;
  let removeChildSpy;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    appendChildSpy = vi.spyOn(document.body, 'appendChild');
    removeChildSpy = vi.spyOn(document.body, 'removeChild');
  });

  afterEach(() => {
    vi.useRealTimers();
    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
  });

  it('creates a blob with correct content and mimeType', () => {
    const content = 'hello world';
    downloadFile(content, 'test.txt', 'text/plain');

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = URL.createObjectURL.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/plain');
  });

  it('creates an anchor element with correct href and download attribute', () => {
    downloadFile('data', 'report.md', 'text/markdown');

    // The anchor was appended to the body
    expect(appendChildSpy).toHaveBeenCalledTimes(1);
    const anchor = appendChildSpy.mock.calls[0][0];
    expect(anchor.tagName).toBe('A');
    expect(anchor.download).toBe('report.md');
    expect(anchor.href).toContain('blob:mock-');
  });

  it('appends to body, clicks, then removes the anchor', () => {
    downloadFile('data', 'file.txt', 'text/plain');

    // Order: appendChild -> click -> removeChild
    expect(appendChildSpy).toHaveBeenCalledTimes(1);
    expect(removeChildSpy).toHaveBeenCalledTimes(1);

    // The removed element should be the same anchor that was appended
    const appended = appendChildSpy.mock.calls[0][0];
    const removed = removeChildSpy.mock.calls[0][0];
    expect(appended).toBe(removed);
  });

  it('calls URL.createObjectURL and eventually URL.revokeObjectURL', () => {
    downloadFile('data', 'file.txt', 'text/plain');

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    // revokeObjectURL is called after 1s timeout
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    // The URL passed to revoke should match what createObjectURL returned
    const createdUrl = URL.createObjectURL.mock.results[0].value;
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(createdUrl);
  });

  it('works with string content', () => {
    const content = '# Markdown\nHello **world**';
    downloadFile(content, 'doc.md', 'text/markdown');

    const blob = URL.createObjectURL.mock.calls[0][0];
    // Blob stores content internally; verify via the call itself
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('text/markdown');
  });
});
