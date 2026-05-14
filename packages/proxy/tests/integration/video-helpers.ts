import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateUrl } from "@socialtip/asset-proxy-url-generator";
import { parseProcessingUrl } from "@socialtip/asset-proxy-url-parser";
import { AV, AVC } from "media-codecs";
import MediaInfoFactory, {
  type AudioTrack,
  type GeneralTrack,
  type MediaInfoResult,
  type VideoTrack,
} from "mediainfo.js";

import { h2Fetch as fetch, SERVICE_URL, URL_CONFIG } from "./setup.js";

function resolveFfmpegPath(): string {
  const p: string | null = createRequire(import.meta.url)("ffmpeg-static");
  if (!p) {
    throw new Error("ffmpeg-static did not provide a binary for this platform");
  }
  return p;
}
const ffmpegPath = resolveFfmpegPath();

export const VIDEO_SOURCE_URL = "http://file-server/test-video.mp4";
export const VIDEO_LC_SOURCE_URL = "http://file-server/test-video-lc.mp4";
export const VIDEO_NOAUDIO_SOURCE_URL =
  "http://file-server/test-video-noaudio.mp4";
export const WEBM_SOURCE_URL = "http://file-server/test-video.webm";

const avcItems = AVC.getAllItems();
const avItems = AV.getAllItems();

export async function probeCodecs(buf: Buffer): Promise<string[]> {
  const mi = await MediaInfoFactory();
  const result: MediaInfoResult = await mi.analyzeData(
    () => buf.length,
    (size: number, offset: number) => new Uint8Array(buf.buffer, offset, size),
  );
  mi.close();

  const tracks = result.media?.track ?? [];
  const codecs: string[] = [];
  for (const track of tracks) {
    if (track["@type"] === "Video") {
      const vt = track as VideoTrack;
      if (vt.Format === "AVC") {
        const name = `AVC ${vt.Format_Profile} Profile Level ${vt.Format_Level}`;
        const item = avcItems.find((i) => i.name === name);
        if (item) codecs.push(item.codec);
      } else if (vt.Format === "AV1") {
        const name = `AV1 ${vt.Format_Profile} Profile Level ${vt.Format_Level} Tier Main BitDepth ${vt.BitDepth}`;
        const item = avItems.find((i) => i.name === name);
        if (item) codecs.push(item.codec);
      }
    } else if (track["@type"] === "Audio") {
      const at = track as AudioTrack;
      if (at.Format === "Opus") {
        codecs.push("opus");
      } else if (at.Format === "AAC") {
        const mp4aMatch = at.CodecID?.match(/mp4a-\d+-\d+/);
        codecs.push(
          mp4aMatch ? mp4aMatch[0].replaceAll("-", ".") : "mp4a.40.2",
        );
      }
    }
  }

  return codecs;
}

export interface VideoMeta {
  width: number;
  height: number;
  duration: number;
  fps: number;
}

export async function probeVideo(filePath: string): Promise<VideoMeta> {
  const buf = readFileSync(filePath);
  const mi = await MediaInfoFactory();
  const result: MediaInfoResult = await mi.analyzeData(
    () => buf.length,
    (size: number, offset: number) => new Uint8Array(buf.buffer, offset, size),
  );
  mi.close();
  const tracks = result.media?.track ?? [];
  const video = tracks.find((t) => t["@type"] === "Video") as
    | VideoTrack
    | undefined;
  const general = tracks.find((t) => t["@type"] === "General") as
    | GeneralTrack
    | undefined;
  if (!video) {
    throw new Error(`No video track found in ${filePath}`);
  }
  return {
    width: Number(video.Width),
    height: Number(video.Height),
    duration: Number(general?.Duration ?? video.Duration ?? 0),
    fps: Number(video.FrameRate),
  };
}

export function extractFrame(videoPath: string): Buffer {
  const tmp = mkdtempSync(join(tmpdir(), "asset-proxy-test-"));
  const framePath = join(tmp, "frame.png");
  execFileSync(
    ffmpegPath,
    [
      "-hide_banner",
      "-y",
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-f",
      "image2",
      framePath,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  return readFileSync(framePath);
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
