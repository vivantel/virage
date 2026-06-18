import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    maxWorkers: 4,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/test-setup.ts",
        "src/minimal.test.tsx",
      ],
    },
    exclude: ["node_modules", ".git", "e2e"],
    globals: true,
    testTimeout: 10000,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
