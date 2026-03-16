import { Readable } from "node:stream";
import { vi } from "vitest";

export const gpuReady = Promise.resolve(false);

export const resizeVideo = vi.fn(() =>
  Promise.resolve(Readable.from(Buffer.from("fake"))),
);
