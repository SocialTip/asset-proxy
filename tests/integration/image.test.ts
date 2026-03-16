import sharp from "sharp";
import { SERVICE_URL, waitForService } from "./setup.js";

const SOURCE_URL = "http://file-server/test-image.png";

beforeAll(waitForService);

async function fetchImage(path: string) {
  const url = `${SERVICE_URL}/insecure${path}/plain/${SOURCE_URL}`;
  const res = await fetch(url);
  expect(res.status).toBe(200);
  return Buffer.from(await res.arrayBuffer());
}

/** Convert any image buffer to PNG for jest-image-snapshot comparison. */
async function toPng(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).png().toBuffer();
}

async function fetchImageWithFormat(path: string, format: string) {
  const url = `${SERVICE_URL}/insecure${path}/plain/${SOURCE_URL}@${format}`;
  const res = await fetch(url);
  expect(res.status).toBe(200);
  return { buffer: Buffer.from(await res.arrayBuffer()), res };
}

describe("image resize", () => {
  it("resize:fit scales to fit within box", async () => {
    const buffer = await fetchImage("/rs:fit:100:100");
    const meta = await sharp(buffer).metadata();
    // 200x150 source → fit into 100x100 → 100x75 (preserves aspect ratio)
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(75);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("resize:fill scales and crops to cover box", async () => {
    const buffer = await fetchImage("/rs:fill:100:100");
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(100);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("resize:force stretches to exact dimensions", async () => {
    const buffer = await fetchImage("/rs:force:80:120");
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(80);
    expect(meta.height).toBe(120);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("width-only resize preserves aspect ratio", async () => {
    const buffer = await fetchImage("/w:100");
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(75);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("height-only resize preserves aspect ratio", async () => {
    const buffer = await fetchImage("/h:75");
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(75);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });
});

describe("image transforms", () => {
  it("rotates 90 degrees", async () => {
    const buffer = await fetchImage("/w:100/rot:90");
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("applies blur", async () => {
    const buffer = await fetchImage("/w:100/bl:5");
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("applies sharpen", async () => {
    const buffer = await fetchImage("/w:100/sh:2");
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("crops to region", async () => {
    const buffer = await fetchImage("/c:100:75/w:100");
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(100);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });
});

describe("image padding and background", () => {
  it("adds uniform padding", async () => {
    const buffer = await fetchImage("/w:100/pd:10");
    const meta = await sharp(buffer).metadata();
    // 100x75 + 10px padding on each side → 120x95
    expect(meta.width).toBe(120);
    expect(meta.height).toBe(95);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("adds padding with background colour", async () => {
    const buffer = await fetchImage("/w:100/pd:20/bg:ff0000");
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });
});

describe("image output formats", () => {
  it("converts to webp", async () => {
    const { buffer, res } = await fetchImageWithFormat("/w:100", "webp");
    expect(res.headers.get("content-type")).toBe("image/webp");
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe("webp");
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("converts to png", async () => {
    const { buffer, res } = await fetchImageWithFormat("/w:100", "png");
    expect(res.headers.get("content-type")).toBe("image/png");
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe("png");
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("converts to avif", async () => {
    const { buffer, res } = await fetchImageWithFormat("/w:100", "avif");
    expect(res.headers.get("content-type")).toBe("image/avif");
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe("heif");
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("defaults to jpg for image sources", async () => {
    const url = `${SERVICE_URL}/insecure/w:100/plain/${SOURCE_URL}`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });
});

describe("image quality", () => {
  it("low quality produces smaller file", async () => {
    const highQ = await fetchImage("/w:100/q:95");
    const lowQ = await fetchImage("/w:100/q:10");
    expect(lowQ.length).toBeLessThan(highQ.length);
    expect(await toPng(lowQ)).toMatchImageSnapshot();
  });
});
