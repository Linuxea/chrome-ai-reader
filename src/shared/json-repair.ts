/**
 * Strip markdown code fence (```json ... ```) from LLM output.
 */
export function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return match ? match[1].trim() : trimmed;
}

/**
 * Extract the first JSON object from text.
 * If `requiredKey` is given, finds the object containing that key.
 */
export function extractJsonObject(text: string, requiredKey?: string): string | null {
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
 */
export function repairLLMJson(jsonStr: string): string {
  const result = jsonStr.replace(/,\s*([}\]])/g, '$1');
  let inString = false;
  let escaped = false;
  let output = '';
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
