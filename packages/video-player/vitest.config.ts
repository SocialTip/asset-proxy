import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineProject } from "vitest/config";

const isCI = !!process.env.CI;

export default defineProject({
  plugins: [react()],
  test: {
    name: "video-player",
    globals: true,
    globalSetup: "./tests/global-setup.ts",
    browser: {
      enabled: true,
      headless: isCI,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
