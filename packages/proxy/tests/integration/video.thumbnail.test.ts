import { generateUrl } from "@socialtip/asset-proxy-url-generator";
import { parseProcessingUrl } from "@socialtip/asset-proxy-url-parser";
import sharp from "sharp";

import { h2Fetch as fetch, SERVICE_URL, URL_CONFIG } from "./setup.js";

const VIDEO_URL = "http://file-server/test-video.mp4";

async function toPng(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).png().toBuffer();
}

function videoUrlWithFormat(path: string, format: string): string {
  const parsed = parseProcessingUrl(
    `/insecure${path}/plain/${VIDEO_URL}@${format}`,
  );
  return `${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`;
}

describe("video thumbnails", () => {
  it("extracts frame at given second (vts)", async () => {
    const url = videoUrlWithFormat("/vts:0/w:128", "jpg");
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const buffer = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(128);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("extracts frame at 0.5 seconds (vts:0.5)", async () => {
    const url = videoUrlWithFormat("/vts:0.5/w:128", "jpg");
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const buffer = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(128);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("extracts keyframe only (vtk)", async () => {
    const url = videoUrlWithFormat("/vtk:1/w:128", "jpg");
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("generates animated gif from video (vta)", async () => {
    const url = videoUrlWithFormat("/vta:0.2:100:5:128:96", "gif");
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/gif");
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(0);
    const meta = await sharp(buffer, { animated: true }).metadata();
    expect(meta.pages).toBeGreaterThan(1);
  });

  it("generates animated webp from video (vta)", async () => {
    const url = videoUrlWithFormat("/vta:0.2:100:5:128:96", "webp");
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(0);
    const meta = await sharp(buffer, { animated: true }).metadata();
    expect(meta.pages).toBeGreaterThan(1);
  });

  it("vta fit preserves aspect ratio within box", async () => {
    const url = videoUrlWithFormat("/vta:0.2:100:3:320:180", "gif");
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const buffer = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buffer, { animated: true }).metadata();
    // Source is portrait (576x1024), fitting into 320x180 should produce height=180 with width < 320
    expect(meta.height! / (meta.pages ?? 1)).toBe(180);
    expect(meta.width).toBeLessThan(320);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("vta fill crops to exact dimensions", async () => {
    const url = videoUrlWithFormat("/vta:0.2:100:3:320:180:0:0:1", "gif");
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const buffer = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buffer, { animated: true }).metadata();
    expect(meta.width).toBe(320);
    expect(meta.height! / (meta.pages ?? 1)).toBe(180);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("vta webp quality affects output size", async () => {
    const qualities = [10, 50, 100] as const;
    const sizes: Record<string, number> = {};
    const buffers: Record<string, Buffer> = {};

    for (const q of qualities) {
      const url = videoUrlWithFormat(`/vta:0.2:100:5/q:${q}`, "webp");
      const res = await fetch(url);
      expect(res.status).toBe(200);
      const buffer = Buffer.from(await res.arrayBuffer());
      sizes[`q${q}`] = buffer.length;
      buffers[`q${q}`] = buffer;
    }

    // Default quality (no q: param)
    const defaultUrl = videoUrlWithFormat("/vta:0.2:100:5", "webp");
    const defaultRes = await fetch(defaultUrl);
    expect(defaultRes.status).toBe(200);
    const defaultBuffer = Buffer.from(await defaultRes.arrayBuffer());
    sizes["default"] = defaultBuffer.length;
    buffers["default"] = defaultBuffer;

    // Lower quality should produce smaller files
    expect(sizes["q10"]).toBeLessThan(sizes["q50"]);
    expect(sizes["q50"]).toBeLessThan(sizes["q100"]);
    // Default (85) should sit between q50 and q100
    expect(sizes["default"]).toBeGreaterThan(sizes["q50"]);
    expect(sizes["default"]).toBeLessThan(sizes["q100"]);

    // Visual snapshots for each quality level
    for (const key of ["q10", "q50", "default", "q100"]) {
      expect(await toPng(buffers[key])).toMatchImageSnapshot({
        customSnapshotIdentifier: `vta-webp-quality-${key}`,
      });
    }
  });

  it("vta extendFrame pads to exact dimensions", async () => {
    const url = videoUrlWithFormat("/vta:0.2:100:3:320:180:1", "gif");
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const buffer = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buffer, { animated: true }).metadata();
    expect(meta.width).toBe(320);
    expect(meta.height! / (meta.pages ?? 1)).toBe(180);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });
});
