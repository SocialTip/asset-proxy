import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    testTimeout: 30_000,
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    onConsoleLog: () => false,
  },
});
