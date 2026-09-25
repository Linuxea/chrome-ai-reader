/**
 * Guard: LLM prompts live in src/shared/prompts.ts (AGENTS.md "LLM Prompts").
 * Inline prompts drifted before — the annotation user prompt was hard-coded
 * Chinese even in English mode, and the podcast-title prompt sat inline in a
 * feature. This scans the TypeScript AST of src/ for:
 *   1. chat messages built with a literal `content` (`{ role: 'system', content: '…' }`);
 *   2. string / template literals containing CJK ideographs — prompt fragments
 *      or UI strings that belong in prompts.ts / i18n.js.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';

const ROOT = join(__dirname, '../..');
const SRC = join(ROOT, 'src');

/** Files allowed to hold CJK literals, and why. */
const CJK_ALLOWED = new Set([
  'src/shared/prompts.ts', // the prompt table itself
  // Content-script UI labels: the content script cannot import i18n.js
  // (panel-only), so it carries its own small zh/en map.
  'src/content/annotation-meta.ts',
  // Context-menu labels: the service worker cannot import i18n.js either.
  'src/background/sw-menus.ts',
]);

/** CJK ideographs only: punctuation alone (a '：' separator, a sentence-splitting set) is not prose. */
const CJK_IDEOGRAPH = /[㐀-鿿]/;

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith('.ts') && !e.name.endsWith('.d.ts') ? [join(dir, e.name)] : [],
  );
}

const isLiteral = (n: ts.Node): boolean =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n);

/** Violations in one file's source text (`rel` is its repo-relative path). */
function scan(rel: string, text: string): string[] {
  const src = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const at = (n: ts.Node) => `${rel}:${src.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;

  const visit = (n: ts.Node): void => {
    if (ts.isObjectLiteralExpression(n)) {
      const prop = (name: string) => n.properties.find(
        (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name,
      );
      const role = prop('role');
      const content = prop('content');
      if (role && content && ts.isStringLiteral(role.initializer)
        && ['system', 'user', 'assistant'].includes(role.initializer.text) && isLiteral(content.initializer)) {
        found.push(`${at(n)} inline ${role.initializer.text} prompt`);
      }
    }
    if (!CJK_ALLOWED.has(rel)) {
      const literal = ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n)
        || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) ? n.text : null;
      if (literal !== null && CJK_IDEOGRAPH.test(literal)) {
        found.push(`${at(n)} CJK literal ${JSON.stringify(literal.slice(0, 40))}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return found;
}

describe('no inline LLM prompts / CJK literals outside prompts.ts', () => {
  it('src/ holds none', () => {
    const violations = tsFiles(SRC).flatMap((f) => scan(relative(ROOT, f), readFileSync(f, 'utf8')));
    expect(violations, 'move these into src/shared/prompts.ts (prompts) or src/shared/i18n.js (UI strings)').toEqual([]);
  });

  it('the scanner catches both patterns, and ignores computed content / punctuation', () => {
    const bad = [
      "const a = { role: 'system', content: 'You are a helpful assistant.' };",
      'const b = { role: \'user\', content: `Summarize ${x}` };',
      'const c = `以下是文章：${x}`;',
    ].join('\n');
    expect(scan('src/x.ts', bad)).toEqual([
      'src/x.ts:1 inline system prompt',
      'src/x.ts:2 inline user prompt',
      'src/x.ts:3 CJK literal "以下是文章："',
    ]);
    const ok = "const m = { role: 'system', content: getPrompt('k') }; const sep = '：';";
    expect(scan('src/y.ts', ok)).toEqual([]);
    expect(scan('src/shared/prompts.ts', "const z = '你好';")).toEqual([]);
  });
});
