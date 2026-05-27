// shared/json-repair.js — Utilities for cleaning/repairing LLM JSON output

/**
 * Strip markdown code fence (```json ... ```) from LLM output.
 * @param {string} text - Raw LLM output that may be wrapped in a code fence
 * @returns {string} The inner content without fence markers, or the trimmed original
 */
export function stripMarkdownFence(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return match ? match[1].trim() : trimmed;
}

/**
 * Extract the first JSON object from text.
 * If `requiredKey` is given, finds the object containing that key.
 * @param {string} text - Text containing a JSON object
 * @param {string} [requiredKey] - Optional key that must exist in the matched object
 * @returns {string|null} The matched JSON string, or null if not found
 */
export function extractJsonObject(text, requiredKey) {
  const pattern = requiredKey
    ? new RegExp(`\\{[\\s\\S]*"${requiredKey}"[\\s\\S]*\\}`)
    : /\{[\s\S]*\}/;
  const match = text.match(pattern);
  return match ? match[0] : null;
}

/**
 * Fix common JSON issues in LLM output:
 * - Trailing commas before ] or }
 * - Unescaped newlines/tabs/carriage returns in string values
 * @param {string} jsonStr - Raw JSON string from LLM output
 * @returns {string} Repaired JSON string safe to parse
 */
export function repairLLMJson(jsonStr) {
  let result = jsonStr.replace(/,\s*([}\]])/g, '$1');
  let inString = false, escaped = false, output = '';
  for (let i = 0; i < result.length; i++) {
    const ch = result[i];
    if (escaped) { output += ch; escaped = false; continue; }
    if (ch === '\\' && inString) { output += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; output += ch; continue; }
    if (inString) {
      if (ch === '\n') { output += '\\n'; continue; }
      if (ch === '\r') { output += '\\r'; continue; }
      if (ch === '\t') { output += '\\t'; continue; }
    }
    output += ch;
  }
  return output;
}
