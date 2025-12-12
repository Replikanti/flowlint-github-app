import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    pool: 'vmThreads',
    exclude: ['**/node_modules/**', '**/dist/**', '.idea', '.git', '.cache'],
    setupFiles: ['./tests/setup-env.ts'],
  },
  resolve: {
    alias: {
      packages: path.resolve(__dirname, './packages'),
    },
  },
});
