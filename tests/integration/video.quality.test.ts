import { fetchVideo, extractFrame } from "./video-helpers.js";

describe("video quality", () => {
  it("high quality produces larger file", async () => {
    const highQ = await fetchVideo("/rs:force:128:128/q:95/ct:1");
    const lowQ = await fetchVideo("/rs:force:128:128/q:10/ct:1");
    expect(lowQ.buffer.length).toBeLessThan(highQ.buffer.length);
  });

  it("high quality first frame", async () => {
    const { videoPath } = await fetchVideo("/rs:force:128:128/q:95/ct:1");
    const frame = extractFrame(videoPath);
    expect(frame).toMatchImageSnapshot();
  });

  it("low quality first frame", async () => {
    const { videoPath } = await fetchVideo("/rs:force:128:128/q:10/ct:1");
    const frame = extractFrame(videoPath);
    expect(frame).toMatchImageSnapshot();
  });
});
