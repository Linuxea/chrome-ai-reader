import { watch } from 'rollup';
import { resolve } from 'path';
import { ROOT, IIFE_ENTRIES, iifePlugins, iifeOutput } from './iife-config.js';

for (const { input, name } of IIFE_ENTRIES) {
  const watcher = watch({
    input: resolve(ROOT, input),
    plugins: iifePlugins(),
    output: iifeOutput(name, { dev: true }),
    watch: {
      // Shared modules are bundled into both scripts — watch them too.
      include: [resolve(ROOT, 'src/content/**'), resolve(ROOT, 'src/background/**'), resolve(ROOT, 'src/shared/**')],
    },
  });

  watcher.on('event', (event) => {
    if (event.code === 'START') {
      console.log(`[IIFE] Watching ${name}...`);
    } else if (event.code === 'BUNDLE_END') {
      event.result.close();
      console.log(`[IIFE] Rebuilt dist/${name}.js`);
    } else if (event.code === 'ERROR') {
      console.error(`[IIFE] Error in ${name}:`, event.error);
    }
  });
}
