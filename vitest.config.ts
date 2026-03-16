import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    onConsoleLog: () => false,
  },
});
