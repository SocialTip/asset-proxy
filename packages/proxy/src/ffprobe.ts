import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { LRUCache } from "lru-cache";
import { z } from "zod/v4";

import { logger } from "./logger.js";
import { recordException, tracer } from "./tracing.js";

/** Information about an audio stream probed from a video. */
export interface AudioProbe {
  /** E.g. aac, opus */
  codec: string;
  /** Audio codec profile, e.g. LC, HE-AAC */
  profile: string | undefined;
}

/** Probed source media information. */
export interface SourceProbe {
  audio: AudioProbe | undefined;
  width: number;
  height: number;
  fps: number;
}

const ffprobeStreamSchema = z
  .object({
    codec_type: z.string(),
    codec_name: z.string().optional(),
    profile: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    r_frame_rate: z
      .string()
      .transform((v) =>
        /^\d+\/\d+$/.test(v) ? (v as `${number}/${number}`) : undefined,
      )
      .optional(),
  })
  .passthrough();

const ffprobeResultSchema = z
  .object({
    streams: z.array(ffprobeStreamSchema).default([]),
  })
  .passthrough();

const cache = new LRUCache<string, Promise<SourceProbe>>({ max: 200 });

/** Clear the probe cache. Exposed for testing only. */
export function clearProbeCache(): void {
  cache.clear();
}

/** Probe source video dimensions, framerate, and audio codec via ffprobe. Memoised on sourceUrl. */
export async function probeSource(sourceUrl: string): Promise<SourceProbe> {
  const span = tracer.startSpan("exec.ffprobe");
  const cached = cache.get(sourceUrl);
  if (cached) {
    span.setAttribute("probe.cache_hit", true);
    try {
      return await cached;
    } finally {
      span.end();
    }
  }

  const promise = probeSourceImpl(sourceUrl);
  cache.set(sourceUrl, promise);
  try {
    const result = await promise;
    span.setAttributes({
      "probe.cache_hit": false,
      "probe.width": result.width,
      "probe.height": result.height,
      "probe.fps": result.fps,
      "probe.audio_codec": result.audio?.codec ?? "none",
    });
    return result;
  } catch (err) {
    recordException(span, err);
    throw err;
  } finally {
    span.end();
  }
}

async function probeSourceImpl(sourceUrl: string): Promise<SourceProbe> {
  try {
    const { stdout } = await promisify(execFile)("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,profile,width,height,r_frame_rate",
      "-of",
      "json",
      sourceUrl,
    ]);
    const { streams } = ffprobeResultSchema.parse(JSON.parse(stdout));
    const videoStream = streams.find((s) => s.codec_type === "video");
    const audioStream = streams.find((s) => s.codec_type === "audio");

    const width = videoStream?.width || 1920;
    const height = videoStream?.height || 1080;
    const fps = videoStream?.r_frame_rate
      ? Number(videoStream.r_frame_rate.split("/")[0]) /
        Number(videoStream.r_frame_rate.split("/")[1])
      : 30;

    const audio = audioStream?.codec_name
      ? { codec: audioStream.codec_name, profile: audioStream.profile }
      : undefined;

    return { audio, width, height, fps };
  } catch (cause) {
    logger.error("[ffprobe] probeSource failed, using defaults", {
      sourceUrl,
      cause,
    });
    return { audio: undefined, width: 1920, height: 1080, fps: 30 };
  }
}
