import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateUrl } from "@socialtip/asset-proxy-url-generator";
import { parseProcessingUrl } from "@socialtip/asset-proxy-url-parser";

import { h2Fetch as fetch, SERVICE_URL, URL_CONFIG } from "./setup.js";

export const VIDEO_SOURCE_URL = "http://file-server/test-video.mp4";

export interface VideoMeta {
  width: number;
  height: number;
  duration: number;
  fps: number;
}

export function probeVideo(filePath: string): VideoMeta {
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

export function extractFrame(videoPath: string): Buffer {
  const tmp = mkdtempSync(join(tmpdir(), "asset-proxy-test-"));
  const framePath = join(tmp, "frame.png");
  execSync(
    `ffmpeg -hide_banner -y -i "${videoPath}" -frames:v 1 -f image2 "${framePath}"`,
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  return execSync(`cat "${framePath}"`);
}

export async function fetchVideo(
  path: string,
): Promise<{ buffer: Buffer; videoPath: string }> {
  const parsed = parseProcessingUrl(
    `/insecure${path}/plain/${VIDEO_SOURCE_URL}`,
  );
  const url = `${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`;
  const res = await fetch(url);
  expect(res.status).toBe(200);
  const buffer = Buffer.from(await res.arrayBuffer());
  const tmp = mkdtempSync(join(tmpdir(), "asset-proxy-test-"));
  const videoPath = join(tmp, "output.mp4");
  writeFileSync(videoPath, buffer);
  return { buffer, videoPath };
}

export { SERVICE_URL };
