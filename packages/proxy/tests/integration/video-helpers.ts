import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateUrl } from "@socialtip/asset-proxy-url-generator";
import { parseProcessingUrl } from "@socialtip/asset-proxy-url-parser";
import { AV, AVC } from "media-codecs";
import MediaInfoFactory from "mediainfo.js";

import { h2Fetch as fetch, SERVICE_URL, URL_CONFIG } from "./setup.js";

export const VIDEO_SOURCE_URL = "http://file-server/test-video.mp4";
export const WEBM_SOURCE_URL = "http://file-server/test-video.webm";

const avcItems = AVC.getAllItems();
const avItems = AV.getAllItems();

interface MediaInfoTrack {
  "@type": string;
  Format?: string;
  Format_Profile?: string;
  Format_Level?: string;
  CodecID?: string;
  BitDepth?: number;
  [key: string]: unknown;
}

export async function probeCodecs(buf: Buffer): Promise<string[]> {
  const mi = await MediaInfoFactory();
  const result = await mi.analyzeData(
    () => buf.length,
    (size: number, offset: number) => new Uint8Array(buf.buffer, offset, size),
  );
  mi.close();

  const codecs: string[] = [];
  for (const track of (result as { media: { track: MediaInfoTrack[] } }).media
    .track) {
    if (track["@type"] === "Video") {
      if (track.Format === "AVC") {
        const name = `AVC ${track.Format_Profile} Profile Level ${track.Format_Level}`;
        const item = avcItems.find((i) => i.name === name);
        if (item) codecs.push(item.codec);
      } else if (track.Format === "AV1") {
        const name = `AV1 ${track.Format_Profile} Profile Level ${track.Format_Level} Tier Main BitDepth ${track.BitDepth}`;
        const item = avItems.find((i) => i.name === name);
        if (item) codecs.push(item.codec);
      }
    } else if (track["@type"] === "Audio") {
      if (track.Format === "Opus") {
        codecs.push("opus");
      } else if (track.Format === "AAC") {
        const codecId = track.CodecID as string | undefined;
        const mp4aMatch = codecId?.match(/mp4a-\d+-\d+/);
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
