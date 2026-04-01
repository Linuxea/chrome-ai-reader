import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '',  // Use relative paths — required for Chrome extension
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: 'inline',
    modulePreload: false,  // Not needed for Chrome extensions
    rollupOptions: {
      input: {
        side_panel: resolve(__dirname, 'src/side_panel/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
      },
      output: {
        // Place entry chunks next to their HTML files, shared chunks in assets/
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
