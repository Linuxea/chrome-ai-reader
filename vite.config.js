import { defineConfig } from 'vite';
import { resolve } from 'path';

// `npm run dev` runs this build in watch mode next to scripts/watch-iife.js,
// which writes dist/content.js + dist/background.js. Vite empties outDir on
// EVERY watch rebuild, which would delete those bundles — so only empty it
// for one-shot builds.
const isWatch = process.argv.includes('--watch') || process.argv.includes('-w');

// DIST_DIR overrides the output directory (absolute path, e.g. a Windows
// drive mount so the unpacked extension survives WSL being shut down).
const outDir = process.env.DIST_DIR || 'dist';

export default defineConfig({
  base: '',  // Use relative paths — required for Chrome extension
  build: {
    outDir,
    emptyOutDir: !isWatch,
    // Inline maps roughly double the shipped bundle; dev (watch) keeps them.
    sourcemap: isWatch ? 'inline' : false,
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
