import sharp from "sharp";
import { SERVICE_URL } from "./setup.js";

const VIDEO_URL = "http://file-server/test-video.mp4";

async function toPng(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).png().toBuffer();
}

describe("video thumbnails", () => {
  it("extracts frame at given second (vts)", async () => {
    const url = `${SERVICE_URL}/insecure/vts:0/w:128/plain/${VIDEO_URL}@jpg`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const buffer = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(128);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("extracts frame at 0.5 seconds (vts:0.5)", async () => {
    const url = `${SERVICE_URL}/insecure/vts:0.5/w:128/plain/${VIDEO_URL}@jpg`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const buffer = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(128);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("extracts keyframe only (vtk)", async () => {
    const url = `${SERVICE_URL}/insecure/vtk:1/w:128/plain/${VIDEO_URL}@jpg`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("generates animated gif from video (vta)", async () => {
    const url = `${SERVICE_URL}/insecure/vta:0.2:100:5:128:96/plain/${VIDEO_URL}@gif`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/gif");
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(0);
    const meta = await sharp(buffer, { animated: true }).metadata();
    expect(meta.pages).toBeGreaterThan(1);
  });

  it("generates animated webp from video (vta)", async () => {
    const url = `${SERVICE_URL}/insecure/vta:0.2:100:5:128:96/plain/${VIDEO_URL}@webp`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(0);
    const meta = await sharp(buffer, { animated: true }).metadata();
    expect(meta.pages).toBeGreaterThan(1);
  });
});
