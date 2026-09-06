import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ["./tests/setup.ts"],
    fileParallelism: false,
    poolOptions: { threads: { singleThread: true } },
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.js", "node_modules/**", "dist/**"],
  },
});
