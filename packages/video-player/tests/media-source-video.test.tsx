import { inject } from "vitest";
import { render } from "vitest-browser-react";

import { MediaSourceVideo } from "../src/media-source-video.js";
import { playVideoWithMediaSource } from "../src/play-video-with-media-source.js";

const serverUrl = inject("fmp4ServerUrl");

it("plays a fragmented mp4 video", async () => {
  const src = `${serverUrl}/cors:1/codec:avc1/test.mp4`;
  const screen = await render(
    <MediaSourceVideo src={src} autoPlay muted data-testid="video" />,
  );

  const video = screen.getByTestId("video");
  await expect.element(video).toBeInTheDocument();

  await vi.waitFor(
    () => {
      const el = video.element() as HTMLVideoElement;
      expect(el.readyState).toBeGreaterThanOrEqual(3);
      expect(el.currentTime).toBeGreaterThan(0.2);
    },
    { timeout: 10_000 },
  );
});

it("throws when url is missing cors:1", () => {
  const url = `${serverUrl}/codec:avc1/test.mp4`;
  const video = document.createElement("video");
  expect(() => playVideoWithMediaSource(video, url)).toThrow("cors:1");
});

it("throws when url is missing codec", () => {
  const url = `${serverUrl}/cors:1/test.mp4`;
  const video = document.createElement("video");
  expect(() => playVideoWithMediaSource(video, url)).toThrow("codec:");
});
