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
});
