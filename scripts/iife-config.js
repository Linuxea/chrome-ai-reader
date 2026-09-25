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

/** `dev`: skip minification (watch mode keeps readable output). */
export function iifePlugins({ dev = false } = {}) {
  return [
    esbuild({ target: 'es2022', minify: !dev }),
    nodeResolve({ browser: true }),
    commonjs(),
  ];
}

/** `dev`: inline source maps (watch mode); production ships without them. */
export function iifeOutput(name, { dev = false } = {}) {
  return {
    file: resolve(ROOT, `dist/${name}.js`),
    format: 'iife',
    // Dependencies with dynamic import() (e.g. @anthropic-ai/sdk) would
    // otherwise need code splitting, which IIFE output cannot do.
    inlineDynamicImports: true,
    sourcemap: dev ? 'inline' : false,
  };
}
