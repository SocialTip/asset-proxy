import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";

// Before `../src/ffmpeg.js` loads: its module-scope GPU probe spawns the real ffmpeg here
// (nothing in this file mocks `child_process`) and exits the process when NVENC is absent.
vi.hoisted(() => {
  process.env.SKIP_GPU = "1";
});

import { detectTrimCrop } from "../src/ffmpeg.js";

// These tests spawn the real ffmpeg on purpose. cropdetect's `skip` option defaults to
// skipping the first frames before detection starts, and `detectTrimCrop` reads exactly
// one frame — so without `skip=0` in the filter string no frame is ever evaluated, no
// `crop=` line is printed, and trim silently no-ops on every still image and extracted
// video frame. A mocked spawn can never catch that; only the binary's own behaviour can.
describe(detectTrimCrop, () => {
  async function letterboxedStill(): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "trim-detect-"));
    const path = join(dir, "letterboxed.png");
    const content = await sharp({
      create: {
        width: 360,
        height: 268,
        channels: 3,
        background: { r: 200, g: 180, b: 160 },
      },
    })
      .png()
      .toBuffer();
    await sharp({
      create: {
        width: 360,
        height: 640,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .composite([{ input: content, top: 186, left: 0 }])
      .png()
      .toFile(path);
    return path;
  }

  it("detects the content band of a letterboxed still image", async () => {
    const path = await letterboxedStill();

    const filter = await detectTrimCrop(path, {
      threshold: 12,
      equalHor: false,
      equalVert: false,
    });

    expect(filter).toBeDefined();
    const match = /^crop=(\d+):(\d+):(\d+):(\d+)$/.exec(filter!);
    expect(match).not.toBeNull();
    const [width, height, x, y] = match!.slice(1).map(Number);
    // round=2 lets cropdetect shave a pixel or two off each edge; the band itself must
    // survive — full width, the 268-row content, anchored at the top bar's end.
    expect(width).toBeGreaterThanOrEqual(352);
    expect(width).toBeLessThanOrEqual(360);
    expect(height).toBeGreaterThanOrEqual(260);
    expect(height).toBeLessThanOrEqual(268);
    expect(x).toBeLessThanOrEqual(8);
    expect(y).toBeGreaterThanOrEqual(182);
    expect(y).toBeLessThanOrEqual(190);
  });

  it("drops the offsets when an equal trim is requested", async () => {
    const path = await letterboxedStill();

    const filter = await detectTrimCrop(path, {
      threshold: 12,
      equalHor: true,
      equalVert: false,
    });

    expect(filter).toMatch(/^crop=\d+:\d+$/);
  });
});
