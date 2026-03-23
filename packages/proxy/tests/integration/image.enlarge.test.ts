import { fetchImage, toPng, sharp } from "./helpers.js";

describe("enlarge", () => {
  // Source image is 200x150

  it("el:0 prevents upscaling beyond original dimensions", async () => {
    const buffer = await fetchImage("/rs:fit:400:400/el:0");
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(150);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("el:1 allows upscaling beyond original dimensions", async () => {
    const buffer = await fetchImage("/rs:fit:400:400/el:1");
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(300);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });
});
