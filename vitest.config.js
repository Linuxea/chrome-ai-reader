import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      include: ['src/**/*.js', 'proxy/**/*.js'],
      exclude: [
        'src/libs/**',
        'src/side_panel/main.js',
      ],
    },
  },
});
