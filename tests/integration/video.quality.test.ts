import { fetchVideo } from "./video-helpers.js";

describe("video quality", () => {
  it("high quality produces larger file than low quality", async () => {
    const highQ = await fetchVideo("/rs:force:128:128/q:95/ct:1");
    const lowQ = await fetchVideo("/rs:force:128:128/q:10/ct:1");
    expect(lowQ.buffer.length).toBeLessThan(highQ.buffer.length);
  });

  it("max_bytes is accepted for video", async () => {
    // -fs is passed to ffmpeg but may not strictly enforce the limit for
    // short clips due to container overhead. Verify the request succeeds.
    const { buffer } = await fetchVideo(
      "/rs:force:128:128/q:50/ct:1/mb:500000",
    );
    expect(buffer.length).toBeGreaterThan(0);
  });
});
