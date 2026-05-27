import { vi, describe, it, expect, beforeEach } from 'vitest';

import { handleExtract } from '../../src/content/page-extractor.js';

describe('content/page-extractor', () => {
  let sendResponse;

  beforeEach(() => {
    sendResponse = vi.fn();
  });

  it('extracts article content from a document with article', () => {
    // Set up a document that Readability can parse
    document.head.innerHTML = '<title>Test Page</title>';
    document.body.innerHTML = `
      <article>
        <h1>Article Title</h1>
        <p>This is the article content with enough text for Readability to consider it a real article. We need to have a decent amount of content here so that Readability doesn't reject it as too short. Adding more sentences to ensure it passes the length threshold.</p>
        <p>Second paragraph with additional content to make sure the article is substantial enough for the Readability algorithm to detect it properly.</p>
      </article>
    `;

    const result = handleExtract({}, sendResponse);
    expect(result).toBe(true);

    // sendResponse is called synchronously within the try block
    expect(sendResponse).toHaveBeenCalled();
    const response = sendResponse.mock.calls[0][0];
    expect(response.success).toBe(true);
    expect(response.data).toBeDefined();
    expect(response.data.title).toBeTruthy();
    expect(response.data.textContent).toBeTruthy();
  });

  it('returns body text as fallback when Readability cannot parse', () => {
    // Minimal document that Readability will reject
    document.head.innerHTML = '<title>Fallback Test</title>';
    document.body.innerHTML = '<div>Just some text</div>';

    handleExtract({}, sendResponse);

    expect(sendResponse).toHaveBeenCalled();
    const response = sendResponse.mock.calls[0][0];
    expect(response.success).toBe(true);
    // Either parsed article or fallback body text
    expect(response.data).toBeDefined();
  });

  it('handles exceptions gracefully', () => {
    // Force an error by making document.cloneNode throw
    const original = document.cloneNode;
    document.cloneNode = () => { throw new Error('clone failed'); };

    handleExtract({}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('clone failed'),
      })
    );

    document.cloneNode = original;
  });

  it('includes all expected fields in response data', () => {
    document.head.innerHTML = '<title>Field Test</title>';
    document.body.innerHTML = `
      <article>
        <h1>Full Article</h1>
        <p>Content with enough text for Readability to parse successfully. This needs to be a substantial block of text so that the Mozilla Readability library recognizes it as an actual article with real content worth reading.</p>
        <p>More content here to ensure we have sufficient text length for the parser.</p>
      </article>
    `;

    handleExtract({}, sendResponse);

    const response = sendResponse.mock.calls[0][0];
    expect(response.data).toHaveProperty('title');
    expect(response.data).toHaveProperty('textContent');
    expect(response.data).toHaveProperty('excerpt');
    expect(response.data).toHaveProperty('content');
    expect(response.data).toHaveProperty('byline');
    expect(response.data).toHaveProperty('siteName');
  });

  it('returns true to indicate async sendResponse', () => {
    document.body.innerHTML = '<p>text</p>';
    const result = handleExtract({}, sendResponse);
    expect(result).toBe(true);
  });
});
