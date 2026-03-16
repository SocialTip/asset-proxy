import { vi } from "vitest";

export const processImage = vi.fn(() =>
  Promise.resolve(Buffer.from("fake-image")),
);
