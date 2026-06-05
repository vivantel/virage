import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: 4,

    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
    exclude: ["node_modules", ".git", "test/acceptance/**"],
    globals: true,
    testTimeout: 10000,
    environment: "node",
  },
});
