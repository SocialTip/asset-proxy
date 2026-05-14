import { extractFrame, fetchVideo, probeVideo } from "./video-helpers.js";

describe("video flip", () => {
  it("flips video vertically", async () => {
    const { videoPath } = await fetchVideo("/flip:0:1/ct:1");
    const frame = extractFrame(videoPath);
    expect(frame).toMatchImageSnapshot();
  });
});

describe("video framerate", () => {
  it("limits framerate to 10fps", async () => {
    const { videoPath } = await fetchVideo("/fr:10/ct:1");
    const meta = await probeVideo(videoPath);
    expect(meta.fps).toBe(10);
  });
});
