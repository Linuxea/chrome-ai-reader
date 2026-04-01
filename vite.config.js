import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: 'inline',
    rollupOptions: {
      input: {
        side_panel: resolve(__dirname, 'src/side_panel/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
      },
    },
  },
});
