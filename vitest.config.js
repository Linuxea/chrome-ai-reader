import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'), // mirrors vite.config.js / tsconfig paths
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // RTL matcher augmentation (toBeInTheDocument etc.) — inert for the
    // legacy DOM tests, required for panel/ React tests.
    setupFiles: ['tests/helpers/rtl-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      // 源码已迁移至 TypeScript，必须同时包含 .js 和 .ts。
      // 注意 .tsx（React 组件）不在此模式内——与 panel 一致，组件逻辑
      // 由 stores/lib 的 .ts 测试间接覆盖。
      include: ['src/**/*.{js,ts}', 'proxy/**/*.js'],
      exclude: [
        // 纯类型定义文件，无运行时代码
        'src/shared/types.ts',
        'src/shared/types.js',
        // 入口编排文件，仅调用 init() 组装，测试 ROI 极低
        'src/content/index.ts',
      ],
      // 覆盖率门槛：阶段 3 完成后提升。
      // 当前覆盖率：lines 62%, functions 55%, branches 54%, statements 59%
      thresholds: {
        lines: 55,
        functions: 50,
        branches: 45,
        statements: 52,
      },
    },
  },
});
