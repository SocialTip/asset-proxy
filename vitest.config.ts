import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*"],
    reporters: ["default"],
    printConsoleTrace: false,
    onConsoleLog: () => false,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**"],
    },
  },
});
