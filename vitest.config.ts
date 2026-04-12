import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/astro",
      "packages/url-parser",
      "packages/url-generator",
      "packages/proxy",
      "packages/proxy/vitest.integration.config.ts",
    ],
    reporters: ["default"],
    printConsoleTrace: false,
    silent: "passed-only",
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**"],
      exclude: ["**/*.astro", "**/__mocks__/**"],
      reporter: ["text", "lcov"],
    },
  },
});
