vi.hoisted(() => {
  process.env.SKIP_GPU = "1";
});

import { predictOutputDimensions } from "../src/ffmpeg.js";

describe("predictOutputDimensions", () => {
  describe("no resize", () => {
    it("returns source dimensions when no resize is specified", () => {
      expect(predictOutputDimensions(undefined, 1920, 1080)).toEqual({
        width: 1920,
        height: 1080,
      });
    });

    it("returns undefined when no resize and no source dimensions", () => {
      expect(predictOutputDimensions(undefined, undefined, undefined)).toEqual({
        width: undefined,
        height: undefined,
      });
    });
  });

  describe("force", () => {
    it("returns exact target dimensions", () => {
      expect(
        predictOutputDimensions(
          { type: "force", width: 200, height: 200 },
          1920,
          1080,
        ),
      ).toEqual({ width: 200, height: 200 });
    });

    it("uses source dimension when target is zero", () => {
      expect(
        predictOutputDimensions(
          { type: "force", width: 200, height: 0 },
          1920,
          1080,
        ),
      ).toEqual({ width: 200, height: 1080 });
    });
  });

  describe("fill", () => {
    it("returns exact target dimensions (scales to cover then crops)", () => {
      expect(
        predictOutputDimensions(
          { type: "fill", width: 200, height: 200 },
          1920,
          1080,
        ),
      ).toEqual({ width: 200, height: 200 });
    });
  });

  describe("fit", () => {
    it("scales landscape source to fit within box", () => {
      // 1920x1080 → fit into 200x200: scale by min(200/1920, 200/1080) = 200/1920
      // → 200 x 112.5 → 200 x 113
      expect(
        predictOutputDimensions(
          { type: "fit", width: 200, height: 200 },
          1920,
          1080,
        ),
      ).toEqual({ width: 200, height: 113 });
    });

    it("scales portrait source to fit within box", () => {
      // 576x1024 → fit into 200x200: scale by min(200/576, 200/1024) = 200/1024
      // → 112.5 x 200 → 113 x 200
      expect(
        predictOutputDimensions(
          { type: "fit", width: 200, height: 200 },
          576,
          1024,
        ),
      ).toEqual({ width: 113, height: 200 });
    });

    it("returns undefined axes when source dimensions are unknown", () => {
      expect(
        predictOutputDimensions(
          { type: "fit", width: 200, height: 200 },
          undefined,
          undefined,
        ),
      ).toEqual({ width: undefined, height: undefined });
    });

    it("width-only resize preserves aspect ratio", () => {
      // 1920x1080, w:200 → scale = 200/1920, h = 1080 * (200/1920) = 112.5 → 113
      expect(
        predictOutputDimensions(
          { type: "fit", width: 200, height: 0 },
          1920,
          1080,
        ),
      ).toEqual({ width: 200, height: 113 });
    });

    it("height-only resize preserves aspect ratio", () => {
      // 1920x1080, h:200 → scale = 200/1080, w = 1920 * (200/1080) = 355.6 → 356
      expect(
        predictOutputDimensions(
          { type: "fit", width: 0, height: 200 },
          1920,
          1080,
        ),
      ).toEqual({ width: 356, height: 200 });
    });
  });

  describe("fill-down", () => {
    it("never upscales — small source stays small", () => {
      // 100x100 → fill-down 200x200: scale = min(1, max(200/100, 200/100)) = 1
      // → 100x100, crop to min(200,100) x min(200,100) = 100x100
      expect(
        predictOutputDimensions(
          { type: "fill-down", width: 200, height: 200 },
          100,
          100,
        ),
      ).toEqual({ width: 100, height: 100 });
    });

    it("downscales and crops when source is larger", () => {
      // 1920x1080 → fill-down 200x200: scale = min(1, max(200/1920, 200/1080)) = 200/1080 ≈ 0.185
      // → 1920*0.185 = 355.6 → 356, 1080*0.185 = 200
      // crop to min(200,356) x min(200,200) = 200x200
      expect(
        predictOutputDimensions(
          { type: "fill-down", width: 200, height: 200 },
          1920,
          1080,
        ),
      ).toEqual({ width: 200, height: 200 });
    });
  });

  describe("auto", () => {
    it("uses fill when orientations match (both landscape)", () => {
      expect(
        predictOutputDimensions(
          { type: "auto", width: 200, height: 100 },
          1920,
          1080,
        ),
      ).toEqual({ width: 200, height: 100 });
    });

    it("uses fit when orientations differ", () => {
      // Source landscape 1920x1080, target portrait 100x200
      // fit: scale by min(100/1920, 200/1080) = 100/1920 ≈ 0.0521
      // → 100 x 56
      expect(
        predictOutputDimensions(
          { type: "auto", width: 100, height: 200 },
          1920,
          1080,
        ),
      ).toEqual({ width: 100, height: 56 });
    });
  });

  describe("defaults to fit when type is omitted", () => {
    it("uses fit behaviour", () => {
      expect(
        predictOutputDimensions({ width: 200, height: 200 }, 1920, 1080),
      ).toEqual({ width: 200, height: 113 });
    });
  });
});
