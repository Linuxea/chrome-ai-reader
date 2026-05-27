import { watch } from 'rollup';
import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const entries = [
  { input: 'src/content/index.js', name: 'content' },
  { input: 'src/background/service-worker.js', name: 'background' },
];

for (const { input, name } of entries) {
  const watcher = watch({
    input: resolve(root, input),
    plugins: [nodeResolve({ browser: true }), commonjs()],
    output: {
      file: resolve(root, `dist/${name}.js`),
      format: 'iife',
      sourcemap: 'inline',
    },
    watch: {
      include: [resolve(root, 'src/content/**'), resolve(root, 'src/background/**')],
    },
  });

  watcher.on('event', (event) => {
    if (event.code === 'START') {
      console.log(`[IIFE] Watching ${name}...`);
    } else if (event.code === 'BUNDLE_END') {
      console.log(`[IIFE] Rebuilt dist/${name}.js`);
    } else if (event.code === 'ERROR') {
      console.error(`[IIFE] Error in ${name}:`, event.error);
    }
  });
}
