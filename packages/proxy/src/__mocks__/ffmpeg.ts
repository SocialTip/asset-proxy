import { Readable } from "node:stream";

import { vi } from "vitest";

export const gpuReady = Promise.resolve(false);

export const processVideo = vi.fn(() =>
  Promise.resolve({
    stream: Readable.from(Buffer.from("fake")),
    outputFormat: "webm",
  }),
);

export const processImage = vi.fn(() =>
  Promise.resolve(Buffer.from("fake-image")),
);
