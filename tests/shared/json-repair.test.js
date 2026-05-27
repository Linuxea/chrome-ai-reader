import { describe, it, expect } from 'vitest';
import { stripMarkdownFence, extractJsonObject, repairLLMJson } from '../../src/shared/json-repair.js';

describe('stripMarkdownFence', () => {
  it('returns trimmed text when no fence is present', () => {
    expect(stripMarkdownFence('  hello world  ')).toBe('hello world');
  });

  it('strips ```json fence', () => {
    const input = '```json\n{"key": "value"}\n```';
    expect(stripMarkdownFence(input)).toBe('{"key": "value"}');
  });

  it('strips ``` fence without language', () => {
    const input = '```\n{"key": "value"}\n```';
    expect(stripMarkdownFence(input)).toBe('{"key": "value"}');
  });

  it('does not strip inline backticks', () => {
    const input = 'some `code` here';
    expect(stripMarkdownFence(input)).toBe('some `code` here');
  });
});

describe('extractJsonObject', () => {
  it('finds first JSON object without requiredKey', () => {
    const text = 'prefix {"a":1} suffix';
    expect(extractJsonObject(text)).toBe('{"a":1}');
  });

  it('finds JSON object with requiredKey (greedy regex spans from first { to last })', () => {
    // The regex is greedy — it matches from the first { to the last } containing the key
    const text = '{"a":1} {"items": [2]}';
    expect(extractJsonObject(text, 'items')).toBe('{"a":1} {"items": [2]}');
  });

  it('returns null when no JSON object found', () => {
    expect(extractJsonObject('no json here')).toBeNull();
  });

  it('returns null when requiredKey is not present in any object', () => {
    const text = '{"a":1}';
    expect(extractJsonObject(text, 'missing')).toBeNull();
  });

  it('extracts nested object text', () => {
    const text = 'result: {"outer": {"inner": true}} done';
    expect(extractJsonObject(text, 'inner')).toBe('{"outer": {"inner": true}}');
  });
});

describe('repairLLMJson', () => {
  it('fixes trailing commas before ]', () => {
    const input = '{"arr": [1, 2, 3,]}';
    expect(JSON.parse(repairLLMJson(input))).toEqual({ arr: [1, 2, 3] });
  });

  it('fixes trailing commas before }', () => {
    const input = '{"a": 1, "b": 2,}';
    expect(JSON.parse(repairLLMJson(input))).toEqual({ a: 1, b: 2 });
  });

  it('escapes unescaped newlines in string values', () => {
    const input = '{"text": "line1\nline2"}';
    const repaired = repairLLMJson(input);
    expect(JSON.parse(repaired)).toEqual({ text: 'line1\nline2' });
  });

  it('escapes unescaped tabs in string values', () => {
    const input = '{"text": "col1\tcol2"}';
    const repaired = repairLLMJson(input);
    expect(JSON.parse(repaired)).toEqual({ text: 'col1\tcol2' });
  });

  it('escapes unescaped carriage returns in string values', () => {
    const input = '{"text": "line1\rline2"}';
    const repaired = repairLLMJson(input);
    expect(JSON.parse(repaired)).toEqual({ text: 'line1\rline2' });
  });

  it('leaves already-escaped sequences alone', () => {
    const input = '{"text": "line1\\nline2"}';
    const repaired = repairLLMJson(input);
    expect(JSON.parse(repaired)).toEqual({ text: 'line1\nline2' });
  });

  it('handles mixed issues', () => {
    // Trailing comma + unescaped newline in value
    const input = '{"a": [1, 2,], "text": "hello\nworld",}';
    const repaired = repairLLMJson(input);
    expect(JSON.parse(repaired)).toEqual({ a: [1, 2], text: 'hello\nworld' });
  });

  it('does not modify newlines outside string values', () => {
    // Newline between keys should pass through (JSON allows whitespace)
    const input = '{\n"a": 1\n}';
    expect(JSON.parse(repairLLMJson(input))).toEqual({ a: 1 });
  });
});
