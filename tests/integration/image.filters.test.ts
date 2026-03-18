import { fetchImage, fetchImageFrom, toPng } from "./helpers.js";

describe("colour adjustments", () => {
  it("adjusts brightness", async () => {
    const buffer = await fetchImage("/br:80");
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("adjusts contrast and saturation", async () => {
    const buffer = await fetchImage("/co:1.5/sa:0.5");
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("applies monochrome", async () => {
    const buffer = await fetchImage("/mc:1");
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("applies duotone", async () => {
    const buffer = await fetchImage("/dt:1:000033:ffcc00");
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });
});

describe("pixelate", () => {
  it("pixelates butterfly image", async () => {
    const buffer = await fetchImageFrom(
      "/px:10",
      "http://file-server/test-image-butterfly.png",
    );
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });
});

describe("advanced filters", () => {
  it("applies unsharp masking to blurred lines", async () => {
    const buffer = await fetchImageFrom(
      "/ush:always:3:2",
      "http://file-server/test-image-blurred-lines.png",
    );
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("applies colorize overlay", async () => {
    const buffer = await fetchImage("/col:0.4:ff0000");
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("applies gradient overlay", async () => {
    const buffer = await fetchImage("/gr:0.8:000000:down");
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });
});
