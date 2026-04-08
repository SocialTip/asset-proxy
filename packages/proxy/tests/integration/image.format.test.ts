import { generateUrl } from "@socialtip/asset-proxy-url-generator";
import { parseProcessingUrl } from "@socialtip/asset-proxy-url-parser";
import {
  fetchImage,
  fetchImageFrom,
  fetchImageWithFormat,
  toPng,
  sharp,
  SOURCE_URL,
  SERVICE_URL,
} from "./helpers.js";
import { URL_CONFIG, h2Fetch as fetch } from "./setup.js";

const BUTTERFLY_URL = "http://file-server/test-image-butterfly.png";
const TRANSPARENT_URL = "http://file-server/test-image-transparent.png";

describe("image padding and background", () => {
  it("adds uniform padding", async () => {
    const buffer = await fetchImage("/w:100/pd:10");
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(120);
    expect(meta.height).toBe(95);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("adds padding with background colour", async () => {
    const buffer = await fetchImage("/w:100/pd:20/bg:ff0000");
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("extend aspect ratio with background, padding, and resize on transparent source", async () => {
    const buffer = await fetchImageFrom(
      "/bg:255:255:255/exar:1:no/f:webp/g:no/pd:83:83:83:83/rs:fit:400:400",
      TRANSPARENT_URL,
    );
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(566);
    expect(meta.height).toBe(566);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("extend aspect ratio with padding but no background keeps transparency", async () => {
    const buffer = await fetchImageFrom(
      "/exar:1:no/f:png/g:no/pd:83:83:83:83/rs:fit:400:400",
      TRANSPARENT_URL,
    );
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(566);
    expect(meta.height).toBe(566);
    expect(meta.channels).toBe(4);
    expect(meta.hasAlpha).toBe(true);
    // Check that extended/padded area is transparent
    const { data, info } = await sharp(buffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
    };
    // Top-left corner is in the padding area — should be fully transparent
    expect(px(5, 5).a).toBe(0);
    // Centre of the extended band (below the image, before padding) — should be transparent
    expect(px(283, 450).a).toBe(0);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("extend aspect ratio without resize returns an error", async () => {
    const url = `${SERVICE_URL}${generateUrl(
      {
        sourceUrl: TRANSPARENT_URL,
        background: { r: 255, g: 255, b: 255 },
        extendAspectRatio: { enabled: true, gravity: "ce" },
        outputFormat: "webp",
      },
      URL_CONFIG,
    )}`;
    const res = await fetch(url);
    expect(res.status).toBe(400);
    await expect(res.text()).resolves.toMatchInlineSnapshot(
      `"extend_aspect_ratio requires resize dimensions to derive the target aspect ratio"`,
    );
  });

  it("extend with background alpha 50%", async () => {
    const buffer = await fetchImage(
      "/rs:fit:200:200/ex:1/bg:0000ff/bga:0.5/f:png",
    );
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(200);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });
});

describe("image output formats", () => {
  it("converts to webp", async () => {
    const { buffer, res } = await fetchImageWithFormat("/w:100", "webp");
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("content-disposition")).toBe(
      'inline; filename="image.webp"',
    );
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe("webp");
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("converts to png", async () => {
    const { buffer, res } = await fetchImageWithFormat("/w:100", "png");
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toBe(
      'inline; filename="image.png"',
    );
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe("png");
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("converts to avif", async () => {
    const { buffer, res } = await fetchImageWithFormat("/w:100", "avif");
    expect(res.headers.get("content-type")).toBe("image/avif");
    expect(res.headers.get("content-disposition")).toBe(
      'inline; filename="image.avif"',
    );
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("defaults to jpg for image sources", async () => {
    const parsed = parseProcessingUrl(`/insecure/w:100/plain/${SOURCE_URL}`);
    const res = await fetch(`${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("content-disposition")).toBe(
      'inline; filename="image.jpg"',
    );
  });
});

describe("format-specific options", () => {
  it("jpeg progressive encoding", async () => {
    const { buffer, res } = await fetchImageWithFormat("/w:100/jpgo:1", "jpg");
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const meta = await sharp(buffer).metadata();
    expect(meta.isProgressive).toBe(true);
  });

  it("jpeg no_subsample (4:4:4 chroma)", async () => {
    const { buffer, res } = await fetchImageWithFormat(
      "/w:100/jpgo:0:1",
      "jpg",
    );
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const meta = await sharp(buffer).metadata();
    expect(meta.chromaSubsampling).toBe("4:4:4");
  });

  it("png interlaced", async () => {
    const { buffer, res } = await fetchImageWithFormat("/w:100/pngo:1", "png");
    expect(res.headers.get("content-type")).toBe("image/png");
    const meta = await sharp(buffer).metadata();
    expect(meta.isProgressive).toBe(true);
  });

  it("png quantize reduces palette to 4 colours", async () => {
    const normal = await fetchImageFrom("/w:200/f:png", BUTTERFLY_URL);
    const quantized = await fetchImageFrom(
      "/w:200/pngo:0:1:4/f:png",
      BUTTERFLY_URL,
    );
    expect(quantized.length).toBeLessThan(normal.length);
    expect(await toPng(quantized)).toMatchImageSnapshot();
  });

  it("jpeg trellis_quant and optimize_scans reduce file size", async () => {
    const normal = await fetchImageFrom("/w:200/q:80", BUTTERFLY_URL);
    // jpgo:0:0:1:0:1 = no progressive, no no_subsample, trellis_quant=1, no overshoot, optimize_scans=1
    const optimised = await fetchImageFrom(
      "/w:200/q:80/jpgo:0:0:1:0:1",
      BUTTERFLY_URL,
    );
    expect(optimised.length).toBeLessThanOrEqual(normal.length);
  });

  it("webp high compression produces smaller file", async () => {
    const low = await fetchImageFrom("/w:100/q:80/wpo:0/f:webp", BUTTERFLY_URL);
    const high = await fetchImageFrom(
      "/w:100/q:80/wpo:6/f:webp",
      BUTTERFLY_URL,
    );
    expect(high.length).toBeLessThan(low.length);
  });

  it("webp smart_subsample is accepted", async () => {
    const buffer = await fetchImageFrom(
      "/w:100/q:80/wpo:0:1/f:webp",
      BUTTERFLY_URL,
    );
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("webp preset is accepted", async () => {
    const buffer = await fetchImageFrom(
      "/w:100/q:80/wpo:0:0:photo/f:webp",
      BUTTERFLY_URL,
    );
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("avif subsample 4:4:4", async () => {
    const { buffer, res } = await fetchImageWithFormat(
      "/w:100/avo:4:4:4",
      "avif",
    );
    expect(res.headers.get("content-type")).toBe("image/avif");
    expect(buffer.length).toBeGreaterThan(0);
  });
});

describe("best format", () => {
  // test-image.png has entropy ~2.0 (low complexity → lossless branch: PNG or WebP)
  // test-image-butterfly.png has entropy ~7.5 (high complexity → lossy branch: JPG, WebP, or AVIF)
  // BEST_FORMAT_MAX_RESOLUTION is set to 0.005 (5000 pixels) in docker-compose,
  // so w:50 images (~50x38 = 1900px) stay below the limit while w:100+ images exceed it.

  it("selects a lossless encoding for a low-complexity image", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/w:50/f:best/plain/${SOURCE_URL}`,
    );
    const res = await fetch(`${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`);
    expect(res.status).toBe(200);
    const buffer = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(50);
    // Must be a lossless format: PNG, or WebP with VP8L (lossless) marker
    const contentType = res.headers.get("content-type")!;
    if (contentType === "image/png") {
      // PNG is always lossless — pass
    } else if (contentType === "image/webp") {
      expect(buffer.includes(Buffer.from("VP8L"))).toBe(true);
    } else {
      throw new Error(
        `Expected lossless format (png or lossless webp), got ${contentType}`,
      );
    }
  });

  it("selects a lossy encoding for a high-complexity image", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/w:50/f:best/plain/${BUTTERFLY_URL}`,
    );
    const res = await fetch(`${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`);
    expect(res.status).toBe(200);
    const buffer = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(50);
    // Must be a lossy format: JPEG, AVIF, or WebP with VP8 (lossy) marker
    const contentType = res.headers.get("content-type")!;
    if (contentType === "image/jpeg" || contentType === "image/avif") {
      // Inherently lossy — pass
    } else if (contentType === "image/webp") {
      expect(buffer.includes(Buffer.from("VP8 "))).toBe(true);
    } else {
      throw new Error(
        `Expected lossy format (jpeg, avif, or lossy webp), got ${contentType}`,
      );
    }
  });

  it("best format with quality respects quality setting for complex images", async () => {
    const lowQParsed = parseProcessingUrl(
      `/insecure/w:50/q:10/f:best/plain/${BUTTERFLY_URL}`,
    );
    const highQParsed = parseProcessingUrl(
      `/insecure/w:50/q:95/f:best/plain/${BUTTERFLY_URL}`,
    );
    const lowQ = await fetch(
      `${SERVICE_URL}${generateUrl(lowQParsed, URL_CONFIG)}`,
    );
    const highQ = await fetch(
      `${SERVICE_URL}${generateUrl(highQParsed, URL_CONFIG)}`,
    );
    expect(lowQ.status).toBe(200);
    expect(highQ.status).toBe(200);
    const lowBuffer = Buffer.from(await lowQ.arrayBuffer());
    const highBuffer = Buffer.from(await highQ.arrayBuffer());
    expect(lowBuffer.length).toBeLessThan(highBuffer.length);
  });

  it("best format produces smaller output than an arbitrary format", async () => {
    const bestParsed = parseProcessingUrl(
      `/insecure/w:50/f:best/plain/${BUTTERFLY_URL}`,
    );
    const jpgParsed = parseProcessingUrl(
      `/insecure/w:50/plain/${BUTTERFLY_URL}@jpg`,
    );
    const pngParsed = parseProcessingUrl(
      `/insecure/w:50/plain/${BUTTERFLY_URL}@png`,
    );
    const best = await fetch(
      `${SERVICE_URL}${generateUrl(bestParsed, URL_CONFIG)}`,
    );
    const jpg = await fetch(
      `${SERVICE_URL}${generateUrl(jpgParsed, URL_CONFIG)}`,
    );
    const png = await fetch(
      `${SERVICE_URL}${generateUrl(pngParsed, URL_CONFIG)}`,
    );
    expect(best.status).toBe(200);
    const bestBuf = Buffer.from(await best.arrayBuffer());
    const jpgBuf = Buffer.from(await jpg.arrayBuffer());
    const pngBuf = Buffer.from(await png.arrayBuffer());
    expect(bestBuf.length).toBeLessThanOrEqual(
      Math.max(jpgBuf.length, pngBuf.length),
    );
  });

  it("falls back to JPEG when image exceeds max resolution", async () => {
    // Requires BEST_FORMAT_MAX_RESOLUTION=0.005 in docker-compose.yml and cicd.yml.
    expect(process.env.BEST_FORMAT_MAX_RESOLUTION).toBe("0.005");

    // At w:200, output is ~200x150 = 30000 pixels which exceeds 0.005 MP → JPEG fallback.
    const parsed = parseProcessingUrl(
      `/insecure/w:200/f:best/plain/${SOURCE_URL}`,
    );
    const res = await fetch(`${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`);
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

  it("format_quality overrides global quality for jpg", async () => {
    const globalQ = await fetchImageFrom("/q:95", BUTTERFLY_URL);
    const fmtQ = await fetchImageFrom("/q:95/fq:jpg:10", BUTTERFLY_URL);
    expect(fmtQ.length).toBeLessThan(globalQ.length);
    expect(await toPng(fmtQ)).toMatchImageSnapshot();
  });

  it("max_bytes limits output size", async () => {
    const unlimited = await fetchImageFrom("/w:200/q:95", BUTTERFLY_URL);
    const limited = await fetchImageFrom("/w:200/q:95/mb:3000", BUTTERFLY_URL);
    expect(limited.length).toBeLessThanOrEqual(3000);
    expect(limited.length).toBeLessThan(unlimited.length);
    expect(await toPng(limited)).toMatchImageSnapshot();
  });

  it("autoquality by size limits output", async () => {
    const auto = await fetchImageFrom(
      "/w:200/aq:size:3000:1:95",
      BUTTERFLY_URL,
    );
    expect(auto.length).toBeLessThanOrEqual(3000);
    expect(await toPng(auto)).toMatchImageSnapshot();
  });

  it("autoquality by DSSIM adjusts quality", async () => {
    // aq:dssim:0.02:60:95 — binary search between q60-95 targeting DSSIM 0.02
    const auto = await fetchImageFrom(
      "/w:200/aq:dssim:0.02:60:95",
      BUTTERFLY_URL,
    );
    const highQ = await fetchImageFrom("/w:200/q:95", BUTTERFLY_URL);
    // Autoquality should produce a smaller file than max quality
    expect(auto.length).toBeLessThan(highQ.length);
    expect(await toPng(auto)).toMatchImageSnapshot();
  });
});
