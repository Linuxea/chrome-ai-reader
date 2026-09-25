/**
 * Layering + cycle rules for src/ (see AGENTS.md "Source Layout").
 * Run: npm run lint:deps. Resolves real import targets (TS paths, .js→.ts
 * specifiers), so a rule can't be dodged by how an import is spelled.
 *
 *   shared ← platform ← state ← ui ← services ← features ← shell
 *   background / content / options sit beside side_panel and share only
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
    layer('shared-is-a-leaf', '^src/shared/', '^src/(platform|side_panel|background|content|options)/',
      'shared/ is pure data + helpers usable from every context.'),
    layer('platform-only-uses-shared', '^src/platform/', '^src/(side_panel|background|content|options)/',
      'platform/ wraps chrome.* for everyone; it must not know its callers.'),
    layer('contexts-are-separate', '^src/(background|content)/', '^src/(side_panel|options)/',
      'The worker and content script are separate bundles; share code through shared/.'),
    layer('side-panel-does-not-import-other-contexts', '^src/(side_panel|options)/', '^src/(background|content)/',
      'Talk to the worker / content script over messages, not imports.'),
    layer('state-below-ui', '^src/side_panel/state\\.ts$', '^src/side_panel/(ui|services|features|shell)/',
      'state.ts sits under every side-panel layer.'),
    layer('ui-below-services', '^src/side_panel/ui/', '^src/side_panel/(services|features|shell)/',
      'ui/ is DOM primitives; wiring to services/features belongs in shell/.'),
    layer('services-below-features', '^src/side_panel/services/', '^src/side_panel/(features|shell)/',
      'Services emit events instead of importing features.'),
    layer('features-below-shell', '^src/side_panel/features/', '^src/side_panel/shell/',
      'shell/ is the composition root; nothing imports it.'),
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.d\\.ts$' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { extensions: ['.ts', '.js'] },
  },
};
