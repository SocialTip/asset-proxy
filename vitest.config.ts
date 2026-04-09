import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

process.env.NODE_EXTRA_CA_CERTS ??= resolve(
  __dirname,
  "packages/proxy/tests/fixtures/certs/cert.pem",
);

const packageAliases = {
  "@socialtip/asset-proxy-url-parser": resolve(
    __dirname,
    "packages/url-parser/src/index.ts",
  ),
  "@socialtip/asset-proxy-url-generator": resolve(
    __dirname,
    "packages/url-generator/src/index.ts",
  ),
};

export default defineConfig({
  test: {
    projects: [
      "packages/astro",
      "packages/url-generator",
      {
        resolve: {
          alias: {
            "@": resolve(__dirname, "packages/proxy/src"),
            ...packageAliases,
          },
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
          alias: {
            "@": resolve(__dirname, "packages/proxy/src"),
            ...packageAliases,
          },
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
      provider: "v8",
      include: ["packages/*/src/**"],
      exclude: ["**/*.astro", "**/__mocks__/**"],
      reporter: ["text", "lcov"],
    },
  },
});
