import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SERVICE_URL = process.env.SERVICE_URL ?? "http://localhost:8080";
const SOURCE_URL = "http://file-server/test-video.mp4";

interface VideoMeta {
  width: number;
  height: number;
}

function probeVideo(filePath: string): VideoMeta {
  const raw = execSync(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json "${filePath}"`,
    { encoding: "utf-8" },
  );
  const parsed = JSON.parse(raw);
  const stream = parsed.streams[0];
  return { width: stream.width, height: stream.height };
}

function extractFrame(videoPath: string): Buffer {
  const tmp = mkdtempSync(join(tmpdir(), "st-assets-test-"));
  const framePath = join(tmp, "frame.png");
  execSync(
    `ffmpeg -hide_banner -y -i "${videoPath}" -frames:v 1 -f image2 "${framePath}"`,
  );
  return execSync(`cat "${framePath}"`);
}

describe("video resize", () => {
  it("resizes to 128x128 fill", async () => {
    const url = `${SERVICE_URL}/insecure/resize:fill:128:128/plain/${SOURCE_URL}`;
    const res = await fetch(url);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");

    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(0);

    // Write to temp file for ffprobe/ffmpeg analysis
    const tmp = mkdtempSync(join(tmpdir(), "st-assets-test-"));
    const videoPath = join(tmp, "output.mp4");
    writeFileSync(videoPath, buffer);

    // Assert output dimensions
    const meta = probeVideo(videoPath);
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(128);

    // Snapshot first frame
    const frame = extractFrame(videoPath);
    expect(frame).toMatchImageSnapshot();
  });
});
