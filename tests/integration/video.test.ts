import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SERVICE_URL } from "./setup.js";

const SOURCE_URL = "http://file-server/test-video.mp4";

interface VideoMeta {
  width: number;
  height: number;
  duration: number;
  fps: number;
}

function probeVideo(filePath: string): VideoMeta {
  const raw = execSync(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate -show_entries format=duration -of json "${filePath}"`,
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
  );
  const parsed = JSON.parse(raw);
  const stream = parsed.streams[0];
  const [num, den] = stream.r_frame_rate.split("/").map(Number);
  return {
    width: stream.width,
    height: stream.height,
    duration: parseFloat(parsed.format.duration),
    fps: num / den,
  };
}

function extractFrame(videoPath: string): Buffer {
  const tmp = mkdtempSync(join(tmpdir(), "asset-proxy-test-"));
  const framePath = join(tmp, "frame.png");
  execSync(
    `ffmpeg -hide_banner -y -i "${videoPath}" -frames:v 1 -f image2 "${framePath}"`,
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  return execSync(`cat "${framePath}"`);
}

async function fetchVideo(
  path: string,
): Promise<{ buffer: Buffer; videoPath: string }> {
  const url = `${SERVICE_URL}/insecure${path}/plain/${SOURCE_URL}`;
  const res = await fetch(url);
  expect(res.status).toBe(200);
  const buffer = Buffer.from(await res.arrayBuffer());
  const tmp = mkdtempSync(join(tmpdir(), "asset-proxy-test-"));
  const videoPath = join(tmp, "output.mp4");
  writeFileSync(videoPath, buffer);
  return { buffer, videoPath };
}

describe("video resize", () => {
  it("resizes to 128x128 fill with framerate and trim", async () => {
    const url = `${SERVICE_URL}/insecure/resize:fill:128:128/fr:15/ct:1/plain/${SOURCE_URL}`;
    const res = await fetch(url);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");

    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(0);

    // Write to temp file for ffprobe/ffmpeg analysis
    const tmp = mkdtempSync(join(tmpdir(), "asset-proxy-test-"));
    const videoPath = join(tmp, "output.mp4");
    writeFileSync(videoPath, buffer);

    // Assert output dimensions, framerate, and duration
    const meta = probeVideo(videoPath);
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(128);
    expect(meta.fps).toBe(15);
    expect(meta.duration).toBeLessThanOrEqual(1.5);

    // Snapshot first frame
    const frame = extractFrame(videoPath);
    expect(frame).toMatchImageSnapshot();
  });

  it("crop_aspect_ratio crops video to 1:1", async () => {
    const { videoPath } = await fetchVideo(
      "/resize:force:128:128/car:1:1/fr:15/ct:1",
    );
    const meta = probeVideo(videoPath);
    // After crop to 1:1 then resize to 128x128
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(128);
    const frame = extractFrame(videoPath);
    expect(frame).toMatchImageSnapshot();
  });
});

describe("flip", () => {
  it("flips video vertically", async () => {
    const { videoPath } = await fetchVideo("/flip:0:1/ct:1");
    const frame = extractFrame(videoPath);
    expect(frame).toMatchImageSnapshot();
  });
});
