import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SERVICE_URL, waitForService } from "./setup.js";

const SOURCE_URL = "http://file-server/test-video.mp4";

beforeAll(waitForService);

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

describe("video resize", () => {
  it("resizes to 128x128 fill with framerate and trim", async () => {
    const url = `${SERVICE_URL}/insecure/resize:fill:128:128/fr:15/tr:1/plain/${SOURCE_URL}`;
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
});
