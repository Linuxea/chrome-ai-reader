import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'off',
      // Layering guardrails. Currently WARN during the refactor (Phase 0-1);
      // promoted to ERROR once violations are removed in Phase 2.
      'no-restricted-imports': 'off',
    },
  },
  {
    // UI layer (side_panel/ui/) must not reach down into services, features,
    // or shell — it should be pure DOM primitives. Tracked as a warn until
    // the existing ui/global-events.ts is relocated to shell/ in Phase 2.
    // NOTE: ESLint in this repo only lints .js by default; the rule guards
    // future .js migrations. .ts layering is enforced via tsc + review.
    files: ['src/side_panel/ui/**'],
    rules: {
      'no-restricted-imports': ['warn', {
        patterns: [
          {
            // Match both relative ('../services/...') and absolute-style specifiers.
            group: [
              '../services/*', '../services/**',
              '../features/*', '../features/**',
              '../shell/*', '../shell/**',
              '*/side_panel/services/*', '*/side_panel/services/**',
              '*/side_panel/features/*', '*/side_panel/features/**',
              '*/side_panel/shell/*', '*/side_panel/shell/**',
            ],
            message: 'UI layer (ui/) must not import from services/, features/, or shell/. Move the dependency up to the orchestration layer.',
            allowTypeImports: true,
          },
        ],
      }],
    },
  },
  {
    files: ['proxy/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'proxy/node_modules/', '**/*.min.js'],
  },
];
