import { fetchImage, toPng, sharp } from "./helpers.js";

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

  it("resizing_algorithm:lanczos3 applies lanczos scaling", async () => {
    const buffer = await fetchImage("/rs:fit:100:100/ra:lanczos3");
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(75);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("resizing_algorithm:nearest applies nearest-neighbour scaling", async () => {
    const buffer = await fetchImage("/rs:fit:100:100/ra:nearest");
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(75);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });
});

describe("resize options", () => {
  it("standalone resizing type (t:force)", async () => {
    const buffer = await fetchImage("/t:force/w:80/h:120");
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(80);
    expect(meta.height).toBe(120);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("zoom doubles dimensions", async () => {
    const buffer = await fetchImage("/rs:fit:50:50/z:2");
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(75);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("dpr scales dimensions and padding", async () => {
    const buffer = await fetchImage("/rs:fit:50:50/pd:5/dpr:2");
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(120);
    expect(meta.height).toBe(95);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("min-width enforces minimum output width", async () => {
    const buffer = await fetchImage("/w:50/mw:100");
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBeGreaterThanOrEqual(100);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("min-height enforces minimum output height", async () => {
    const buffer = await fetchImage("/h:30/mh:75");
    const meta = await sharp(buffer).metadata();
    expect(meta.height).toBeGreaterThanOrEqual(75);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("extend pads to fill target dimensions", async () => {
    const buffer = await fetchImage("/rs:fit:200:200/ex:1/bg:0000ff");
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(200);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });
});
