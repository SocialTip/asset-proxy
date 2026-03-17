import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    onConsoleLog: () => false,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/integration/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["./tests/setup.ts", "./tests/integration/setup.ts"],
        },
      },
    ],
  },
});
