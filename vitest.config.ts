import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/astro",
      "packages/url-generator",
      {
        resolve: {
          alias: { "@": resolve(__dirname, "packages/proxy/src") },
        },
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
        resolve: {
          alias: { "@": resolve(__dirname, "packages/proxy/src") },
        },
        test: {
          name: "proxy:integration",
          root: "packages/proxy",
          testTimeout: 30_000,
          globals: true,
          setupFiles: ["./tests/setup.ts", "./tests/integration/setup.ts"],
          include: ["tests/integration/**/*.test.ts"],
          env: {
            BEST_FORMAT_MAX_RESOLUTION: "0.005",
          },
        },
      },
    ],
    reporters: ["default"],
    printConsoleTrace: false,
    silent: "passed-only",
    coverage: {
      provider: "custom",
      customProviderModule: "vitest-monocart-coverage",
      include: ["packages/*/src/**"],
      exclude: ["**/*.astro"],
    },
  },
});
