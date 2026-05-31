import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // ✅ Вместо poolOptions (удалено в v4)
    maxWorkers: 4,           // было maxThreads/maxForks
    isolate: false,          // было singleThread/singleFork: true

    // ✅ Настройки покрытия (coverage.all удалён)
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],     // обязательно для v4
      exclude: ['src/**/*.test.ts'],
    },
    exclude: ['node_modules', '.git'],
    globals: true,
    testTimeout: 10000,
    environment: 'node',
  },
});