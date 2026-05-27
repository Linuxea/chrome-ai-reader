import { rollup } from 'rollup';
import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import esbuild from 'rollup-plugin-esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Supports gradual TS migration: prefers .ts entry if it exists, falls back to .js
function resolveEntry(jsonPath) {
  const tsPath = jsonPath.replace(/\.js$/, '.ts');
  return existsSync(resolve(__dirname, tsPath)) ? tsPath : jsonPath;
}

async function buildIIFE(entry, name) {
  const bundle = await rollup({
    input: resolve(__dirname, entry),
    plugins: [
      esbuild({ target: 'es2022' }),
      nodeResolve({ browser: true }),
      commonjs(),
    ],
  });
  await bundle.write({
    file: resolve(__dirname, `dist/${name}.js`),
    format: 'iife',
    sourcemap: 'inline',
  });
  await bundle.close();
}

await buildIIFE(resolveEntry('src/content/index.js'), 'content');
await buildIIFE(resolveEntry('src/background/service-worker.js'), 'background');
console.log('IIFE bundles written to dist/');
