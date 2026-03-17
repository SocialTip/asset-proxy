import { configureToMatchImageSnapshot } from "jest-image-snapshot";
import { expect } from "vitest";

const toMatchImageSnapshot = configureToMatchImageSnapshot({
  failureThresholdType: "percent",
  failureThreshold: 0.5,
});

expect.extend({ toMatchImageSnapshot });
