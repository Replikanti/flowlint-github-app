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
      include: ['apps/api/src/**', 'apps/worker/src/**', 'packages/github/**'],
      exclude: [
        'tests/**', 
        '**/node_modules/**', 
        '**/tracing.ts', 
        '**/server.ts', 
        '**/worker.ts',
        'packages/tracing/**',
        'packages/logger/**',
        'packages/observability/**', // Mostly tested via integration or boilerplate
        '**/*.json',
        '**/types.ts'
      ],
      thresholds: {
        lines: 80,
        functions: 70,
        branches: 70,
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
