import { resolve } from "node:path";

import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    alias: {
      "@socialtip/asset-proxy-url-parser": resolve(__dirname, "src/index.ts"),
    },
  },
  test: {
    globals: true,
  },
});
