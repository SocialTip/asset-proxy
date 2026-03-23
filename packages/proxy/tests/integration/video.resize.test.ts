import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateUrl } from "@socialtip/asset-proxy-url-generator";
import { parseProcessingUrl } from "@socialtip/asset-proxy-url-parser";
import {
  fetchVideo,
  probeVideo,
  extractFrame,
  VIDEO_SOURCE_URL,
  SERVICE_URL,
} from "./video-helpers.js";
import { URL_CONFIG } from "./setup.js";

describe("video resize", () => {
  it("resizes to 128x128 fill with framerate and cut", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/resize:fill:128:128/fr:15/ct:1/plain/${VIDEO_SOURCE_URL}`,
    );
    const url = `${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`;
    const res = await fetch(url);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");

    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(0);

    const tmp = mkdtempSync(join(tmpdir(), "asset-proxy-test-"));
    const videoPath = join(tmp, "output.mp4");
    writeFileSync(videoPath, buffer);

    const meta = probeVideo(videoPath);
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(128);
    expect(meta.fps).toBe(15);
    expect(meta.duration).toBeLessThanOrEqual(1.5);

    const frame = extractFrame(videoPath);
    expect(frame).toMatchImageSnapshot();
  });

  it("crop_aspect_ratio crops video to 1:1", async () => {
    const { videoPath } = await fetchVideo(
      "/resize:force:128:128/car:1:1/fr:15/ct:1",
    );
    const meta = probeVideo(videoPath);
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(128);
    const frame = extractFrame(videoPath);
    expect(frame).toMatchImageSnapshot();
  });
});
