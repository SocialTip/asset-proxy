import { fetchImage, sharp, toPng } from "./helpers.js";

describe("image transforms", () => {
  it("rotates 90 degrees", async () => {
    const buffer = await fetchImage("/w:100/rot:90");
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("flips horizontally", async () => {
    const buffer = await fetchImage("/flip:1:0");
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("flips vertically", async () => {
    const buffer = await fetchImage("/flip:0:1");
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

  it("crops with compass gravity (nowe)", async () => {
    const buffer = await fetchImage("/c:100:75:nowe");
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(75);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("crops with focus point gravity", async () => {
    const buffer = await fetchImage("/c:100:75/g:fp:0.8:0.8");
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(75);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("crop_aspect_ratio crops to 1:1", async () => {
    const buffer = await fetchImage("/car:1:1");
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(meta.height);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("trims borders from image", async () => {
    const trimmed = await fetchImage("/trim:30");
    const meta = await sharp(trimmed).metadata();
    expect(meta.width).toBeGreaterThan(0);
    expect(meta.height).toBeGreaterThan(0);
    expect(meta.width!).toBeLessThanOrEqual(200);
    expect(meta.height!).toBeLessThanOrEqual(150);
    expect(await toPng(trimmed)).toMatchImageSnapshot();
  });
});
