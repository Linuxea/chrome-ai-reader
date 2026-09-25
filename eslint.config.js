import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  js.configs.recommended,
  // TypeScript: without a parser ESLint never linted a single .ts file (the
  // vast majority of src/). Syntax-level rules only — type safety is tsc's job.
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ['**/*.ts'] })),
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
      // Layering (which directory may import which) is enforced by
      // dependency-cruiser — see .dependency-cruiser.cjs / `npm run lint:deps`.
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      // The base rule misreads type-only usages; the TS-aware one replaces it.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['proxy/**/*.js', 'scripts/**/*.js', '*.config.js', 'build-extension.js'],
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
