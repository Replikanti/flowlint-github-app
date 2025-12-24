import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    pool: 'vmThreads',
    exclude: ['**/node_modules/**', '**/dist/**', '.idea', '.git', '.cache'],
    setupFiles: ['./tests/setup-env.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'clover', 'cobertura'],
      include: ['apps/**', 'packages/**'],
      exclude: ['tests/**', '**/node_modules/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      packages: path.resolve(__dirname, './packages'),
    },
  },
});
