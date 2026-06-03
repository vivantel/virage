import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/acceptance/**/*.test.ts'],
    testTimeout: 360_000,
    hookTimeout: 120_000,
    pool: 'forks',
    sequence: { shuffle: false },
    reporters: ['verbose'],
    globals: true,
    environment: 'node',
  },
});
