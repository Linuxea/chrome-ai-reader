import { rollup } from 'rollup';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function buildIIFE(entry, name) {
  const bundle = await rollup({ input: resolve(__dirname, entry) });
  await bundle.write({
    file: resolve(__dirname, `dist/${name}.js`),
    format: 'iife',
    sourcemap: 'inline',
  });
  await bundle.close();
}

await buildIIFE('src/content/index.js', 'content');
await buildIIFE('src/background/service-worker.js', 'background');
console.log('IIFE bundles written to dist/');
