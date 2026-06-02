import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    maxWorkers: 4,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // store.ts and index.ts require a live LanceDB connection — excluded from unit coverage
      include: ['src/stats.ts', 'src/query-perf.ts'],
      exclude: ['src/**/*.test.ts'],
    },
    exclude: ['node_modules', '.git'],
    globals: true,
    testTimeout: 30000,
    environment: 'node',
  },
});
