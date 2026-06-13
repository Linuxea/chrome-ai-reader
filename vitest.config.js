import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      // 源码已迁移至 TypeScript，必须同时包含 .js 和 .ts
      include: ['src/**/*.{js,ts}', 'proxy/**/*.js'],
      exclude: [
        // 纯类型定义文件，无运行时代码
        'src/shared/types.ts',
        'src/shared/types.js',
        // 入口编排文件，仅调用 init() 组装，测试 ROI 极低
        'src/side_panel/main.ts',
        'src/options/index.ts',
        'src/content/index.ts',
      ],
      // 覆盖率门槛：阶段 2 完成后的防回归底线。
      // 当前覆盖率：lines 48.8%, functions 40.6%, branches 43.2%, statements 44.5%
      // 阶段 3（options/i18n/podcast 测试）完成后提升至 lines:50 functions:50 branches:40 statements:50
      thresholds: {
        lines: 48,
        functions: 40,
        branches: 42,
        statements: 44,
      },
    },
  },
});
