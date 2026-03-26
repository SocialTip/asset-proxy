import { resolve } from "node:path";
import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@socialtip/asset-proxy-url-parser": resolve(
        __dirname,
        "../url-parser/src/index.ts",
      ),
    },
  },
  test: {
    globals: true,
  },
});
