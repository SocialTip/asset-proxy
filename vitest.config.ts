import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/url-generator",
      {
        test: {
          name: "proxy:unit",
          root: "packages/proxy",
          testTimeout: 30_000,
          globals: true,
          setupFiles: ["./tests/setup.ts"],
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/integration/**"],
        },
      },
      {
        test: {
          name: "proxy:integration",
          root: "packages/proxy",
          testTimeout: 30_000,
          globals: true,
          setupFiles: ["./tests/setup.ts", "./tests/integration/setup.ts"],
          include: ["tests/integration/**/*.test.ts"],
        },
      },
    ],
    reporters: ["default"],
    printConsoleTrace: false,
    onConsoleLog: () => false,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**"],
    },
  },
});
