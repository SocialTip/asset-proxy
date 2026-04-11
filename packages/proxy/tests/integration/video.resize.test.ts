import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateUrl } from "@socialtip/asset-proxy-url-generator";
import { parseProcessingUrl } from "@socialtip/asset-proxy-url-parser";

import { h2Fetch as fetch, URL_CONFIG } from "./setup.js";
import {
  extractFrame,
  fetchVideo,
  probeCodecs,
  probeVideo,
  SERVICE_URL,
  VIDEO_LC_SOURCE_URL,
  VIDEO_SOURCE_URL,
  WEBM_SOURCE_URL,
} from "./video-helpers.js";

function writeTmp(buffer: Buffer, ext: string): string {
  const tmp = mkdtempSync(join(tmpdir(), "asset-proxy-test-"));
  const path = join(tmp, `output.${ext}`);
  writeFileSync(path, buffer);
  return path;
}

function parseCodecs(contentType: string): string[] {
  const match = contentType.match(/codecs="([^"]+)"/);
  return match ? match[1].split(",").map((c) => c.trim()) : [];
}

describe("video resize", () => {
  it("resizes to 128x128 fill with framerate and cut", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/resize:fill:128:128/fr:15/ct:1/plain/${VIDEO_SOURCE_URL}`,
    );
    const url = `${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`;
    const res = await fetch(url);

    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type")!;
    expect(contentType).toMatchInlineSnapshot(
      `"video/mp4; codecs="avc1.64000a, mp4a.40.5""`,
    );

    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(0);

    // Regular MP4 should be faststarted: moov before mdat, no moof fragments
    const moovAt = buffer.indexOf("moov");
    const mdatAt = buffer.indexOf("mdat");
    expect(moovAt).toBeGreaterThan(-1);
    expect(mdatAt).toBeGreaterThan(-1);
    expect(moovAt).toBeLessThan(mdatAt);
    expect(buffer.indexOf("moof")).toBe(-1);

    const actualCodecs = await probeCodecs(buffer);
    for (const codec of parseCodecs(contentType)) {
      expect(actualCodecs).toContain(codec);
    }

    const videoPath = writeTmp(buffer, "mp4");
    const meta = probeVideo(videoPath);
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(128);
    expect(meta.fps).toBe(15);
    expect(meta.duration).toBeLessThanOrEqual(1.5);

    const frame = extractFrame(videoPath);
    expect(frame).toMatchImageSnapshot();
  });

  it("fmp4 streams fragmented mp4 with correct codecs", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/resize:fill:128:128/fr:15/ct:1/plain/${VIDEO_SOURCE_URL}@fmp4`,
    );
    const url = `${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`;
    const res = await fetch(url);

    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type")!;
    expect(contentType).toMatchInlineSnapshot(
      `"video/mp4; codecs="avc1.64000a, mp4a.40.5""`,
    );

    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.indexOf("moof")).toBeGreaterThan(-1);

    const actualCodecs = await probeCodecs(buffer);
    for (const codec of parseCodecs(contentType)) {
      expect(actualCodecs).toContain(codec);
    }

    const videoPath = writeTmp(buffer, "mp4");
    const meta = probeVideo(videoPath);
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(128);
  });

  it("mp4 from webm source re-encodes audio to aac", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/resize:fill:128:128/fr:15/ct:1/plain/${WEBM_SOURCE_URL}@mp4`,
    );
    const url = `${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`;
    const res = await fetch(url);

    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type")!;
    expect(contentType).toMatchInlineSnapshot(
      `"video/mp4; codecs="avc1.64000a, mp4a.40.2""`,
    );

    const buffer = Buffer.from(await res.arrayBuffer());
    const actualCodecs = await probeCodecs(buffer);
    for (const codec of parseCodecs(contentType)) {
      expect(actualCodecs).toContain(codec);
    }
  });

  it("mp4 from AAC-LC source has correct audio codec", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/resize:fill:128:128/fr:15/ct:1/plain/${VIDEO_LC_SOURCE_URL}@mp4`,
    );
    const url = `${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`;
    const res = await fetch(url);

    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type")!;
    expect(contentType).toMatchInlineSnapshot(
      `"video/mp4; codecs="avc1.64000a, mp4a.40.2""`,
    );

    const buffer = Buffer.from(await res.arrayBuffer());
    const actualCodecs = await probeCodecs(buffer);
    for (const codec of parseCodecs(contentType)) {
      expect(actualCodecs).toContain(codec);
    }
  });

  it("webm output has av1 video and opus audio", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/resize:fill:128:128/fr:15/ct:1/plain/${VIDEO_SOURCE_URL}@webm`,
    );
    const url = `${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`;
    const res = await fetch(url);

    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type")!;
    expect(contentType).toMatchInlineSnapshot(
      `"video/webm; codecs="av01.0.00M.08, opus""`,
    );

    const buffer = Buffer.from(await res.arrayBuffer());
    const actualCodecs = await probeCodecs(buffer);
    for (const codec of parseCodecs(contentType)) {
      expect(actualCodecs).toContain(codec);
    }
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
