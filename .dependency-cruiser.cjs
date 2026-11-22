/**
 * Layering + cycle rules for src/ (see AGENTS.md "Source Layout").
 * Run: npm run lint:deps. Resolves real import targets (TS paths, .js→.ts
 * specifiers), so a rule can't be dodged by how an import is spelled.
 *
 *   shared ← platform ← panel(state ← stores ← hooks/components ← App)
 *   background / content / options sit beside panel and share only
 *   shared/ + platform/.
 */
const layer = (name, from, to, comment) => ({ name, severity: 'error', comment, from: { path: from }, to: { path: to } });

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Import cycles make init order and mocking fragile.',
      from: {},
      to: { circular: true },
    },
    layer('shared-is-a-leaf', '^src/shared/', '^src/(platform|panel|background|content|options)/',
      'shared/ is pure data + helpers usable from every context.'),
    layer('platform-only-uses-shared', '^src/platform/', '^src/(panel|background|content|options)/',
      'platform/ wraps chrome.* for everyone; it must not know its callers.'),
    layer('contexts-are-separate', '^src/(background|content)/', '^src/(panel|options)/',
      'The worker and content script are separate bundles; share code through shared/.'),
    layer('panel-does-not-import-other-contexts', '^src/panel/', '^src/(background|content)/',
      'Talk to the worker / content script over messages, not imports.'),
    layer('panel-state-below-everything', '^src/panel/state\\.ts$', '^src/panel/(lib|stores|hooks|components)/',
      'state.ts is the framework-free tab-state core; it sits under every panel layer.'),
    layer('panel-lib-below-consumers', '^src/panel/lib/', '^src/panel/(components|hooks)/',
      'lib/ holds controllers and ported services; they must not know their consumers.'),
    layer('panel-stores-below-consumers', '^src/panel/stores/', '^src/panel/(components|hooks)/',
      'Stores hold state; they must not know their consumers.'),
    layer('panel-hooks-below-components', '^src/panel/hooks/', '^src/panel/components/',
      'Hooks are consumed by components, never the reverse.'),
    {
      name: 'panel-ui-primitives-are-leaves',
      severity: 'error',
      comment: 'shadcn primitives (components/ui) may only use radix + lib/utils — no app components/hooks/stores.',
      from: { path: '^src/panel/components/ui/' },
      to: { path: '^src/panel/(components/(chat|composer|panels|layout)|hooks|stores)/' },
    },
    {
      name: 'panel-entry-is-sacred',
      severity: 'error',
      comment: 'main.tsx is the panel entry; App.tsx is mounted only by it.',
      from: { path: '^src/', pathNot: '^src/panel/main\\.tsx$' },
      to: { path: '^src/panel/(main|App)\\.tsx$' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.d\\.ts$' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { extensions: ['.ts', '.js'] },
  },
};
