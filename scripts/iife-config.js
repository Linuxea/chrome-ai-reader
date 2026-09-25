// Shared Rollup config for the IIFE bundles (content script + service
// worker). Used by build-extension.js (production) and scripts/watch-iife.js
// (dev) so the two can never drift apart again — the watcher used to point at
// long-gone .js entries and lacked the esbuild (TypeScript) plugin.
import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import esbuild from 'rollup-plugin-esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const IIFE_ENTRIES = [
  { input: 'src/content/index.ts', name: 'content' },
  { input: 'src/background/service-worker.ts', name: 'background' },
];

export function iifePlugins() {
  return [
    esbuild({ target: 'es2022' }),
    nodeResolve({ browser: true }),
    commonjs(),
  ];
}

export function iifeOutput(name) {
  return {
    file: resolve(ROOT, `dist/${name}.js`),
    format: 'iife',
    sourcemap: 'inline',
  };
}
