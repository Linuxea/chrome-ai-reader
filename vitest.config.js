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
