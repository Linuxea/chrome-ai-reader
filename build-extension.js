import { rollup } from 'rollup';
import { resolve } from 'path';
import { ROOT, IIFE_ENTRIES, iifePlugins, iifeOutput, DIST_DIR } from './scripts/iife-config.js';

for (const { input, name } of IIFE_ENTRIES) {
  const bundle = await rollup({ input: resolve(ROOT, input), plugins: iifePlugins() });
  await bundle.write(iifeOutput(name));
  await bundle.close();
}
console.log(`IIFE bundles written to ${resolve(ROOT, DIST_DIR)}/`);
