import {
  fetchImage,
  fetchImageFrom,
  fetchImageWithFormat,
  toPng,
  sharp,
  SOURCE_URL,
  SERVICE_URL,
} from "./helpers.js";

const BUTTERFLY_URL = "http://file-server/test-image-butterfly.png";

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
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("defaults to jpg for image sources", async () => {
    const url = `${SERVICE_URL}/insecure/w:100/plain/${SOURCE_URL}`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });
});

describe("format-specific options", () => {
  it("jpeg progressive encoding", async () => {
    const buffer = await fetchImage("/w:100/jpgo:1");
    const meta = await sharp(buffer).metadata();
    expect(meta.isProgressive).toBe(true);
  });

  it("jpeg no_subsample (4:4:4 chroma)", async () => {
    const buffer = await fetchImage("/w:100/jpgo:0:1");
    const meta = await sharp(buffer).metadata();
    expect(meta.chromaSubsampling).toBe("4:4:4");
  });

  it("png interlaced", async () => {
    const { buffer } = await fetchImageWithFormat("/w:100/pngo:1", "png");
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
    const { buffer } = await fetchImageWithFormat("/w:100/avo:4:4:4", "avif");
    expect(buffer.length).toBeGreaterThan(0);
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
