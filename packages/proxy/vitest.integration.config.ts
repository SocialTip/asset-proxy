import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

process.env.NODE_EXTRA_CA_CERTS ??= resolve(
  __dirname,
  "tests/fixtures/certs/cert.pem",
);

const packageAliases = {
  "@socialtip/asset-proxy-url-parser": resolve(
    __dirname,
    "../url-parser/src/index.ts",
  ),
  "@socialtip/asset-proxy-url-generator": resolve(
    __dirname,
    "../url-generator/src/index.ts",
  ),
};

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      ...packageAliases,
    },
  },
  test: {
    name: "proxy:integration",
    globals: true,
    testTimeout: 30_000,
    setupFiles: ["./tests/setup.ts", "./tests/integration/setup.ts"],
    include: ["tests/integration/**/*.test.ts"],
    env: {
      BEST_FORMAT_MAX_RESOLUTION: "0.005",
    },
  },
});
