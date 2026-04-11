import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** Information about an audio stream probed from a video */
interface AudioProbe {
  /** E.g. aac, opus */
  codec: string;
  /** Audio codec profile, e.g. LC, HE-ACC */
  profile: string | undefined;
}

/** Probe the source audio codec name and profile via ffprobe. */
export async function probeAudio(
  sourceUrl: string,
): Promise<AudioProbe | undefined> {
  try {
    const { stdout } = await promisify(execFile)("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name,profile",
      "-of",
      "json",
      sourceUrl,
    ]);
    const parsed = JSON.parse(stdout);
    const stream = parsed.streams?.[0];
    if (!stream?.codec_name) return undefined;
    return { codec: stream.codec_name, profile: stream.profile };
  } catch {
    return undefined;
  }
}

// H.264 levels: [max_macroblocks_per_second, max_frame_macroblocks, level_idc]
// Source: https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/h264_levels.c
const H264_LEVELS: [number, number, number][] = [
  [1_485, 99, 10],
  [3_000, 396, 11],
  [6_000, 396, 12],
  [11_880, 396, 13],
  [11_880, 396, 20],
  [19_800, 792, 21],
  [20_250, 1_620, 22],
  [40_500, 1_620, 30],
  [108_000, 3_600, 31],
  [216_000, 5_120, 32],
  [245_760, 8_192, 40],
  [245_760, 8_192, 41],
  [522_240, 8_704, 42],
  [589_824, 22_080, 50],
  [983_040, 36_864, 51],
  [2_073_600, 36_864, 52],
  [4_177_920, 139_264, 60],
  [8_355_840, 139_264, 61],
  [16_711_680, 139_264, 62],
];

function h264Level(width: number, height: number, fps: number): number {
  const mbW = Math.ceil(width / 16);
  const mbH = Math.ceil(height / 16);
  const frameMbs = mbW * mbH;
  const mbsPerSec = frameMbs * fps;
  for (const [maxMbps, maxFrameMbs, levelIdc] of H264_LEVELS) {
    if (mbsPerSec <= maxMbps && frameMbs <= maxFrameMbs) return levelIdc;
  }
  return 62;
}

function h264CodecString(width: number, height: number, fps: number): string {
  const levelIdc = h264Level(width, height, fps);
  return `avc1.6400${levelIdc.toString(16).padStart(2, "0")}`;
}

// AV1 levels: [max_h_size, max_v_size, max_display_rate, seq_level_idx]
// Source: https://github.com/AOMediaCodec/av1-spec/blob/master/annex.a.levels.md
const AV1_LEVELS: [number, number, number, number][] = [
  [2048, 1152, 4_423_680, 0],
  [2816, 1584, 8_363_520, 1],
  [4352, 2448, 19_975_680, 4],
  [5504, 3096, 31_950_720, 5],
  [6144, 3456, 70_778_880, 8],
  [6144, 3456, 141_557_760, 9],
  [8192, 4352, 267_386_880, 12],
  [8192, 4352, 534_773_760, 13],
  [8192, 4352, 1_069_547_520, 14],
  [8192, 4352, 1_069_547_520, 15],
  [16384, 8704, 1_069_547_520, 16],
  [16384, 8704, 2_139_095_040, 17],
  [16384, 8704, 4_278_190_080, 18],
  [16384, 8704, 4_278_190_080, 19],
];

function av1SeqLevelIdx(width: number, height: number, fps: number): number {
  const displayRate = width * height * fps;
  for (const [maxW, maxH, maxRate, idx] of AV1_LEVELS) {
    if (width <= maxW && height <= maxH && displayRate <= maxRate) return idx;
  }
  return 19;
}

function av1CodecString(width: number, height: number, fps: number): string {
  const idx = av1SeqLevelIdx(width, height, fps);
  return `av01.0.${String(idx).padStart(2, "0")}M.08`;
}

const AAC_PROFILE_CODECS: Record<string, string> = {
  LC: "mp4a.40.2",
  "HE-AAC": "mp4a.40.5",
  "HE-AACv2": "mp4a.40.29",
};

function aacCodecString(
  sourceAudioProfile?: string,
  isPassthrough?: boolean,
): string {
  if (isPassthrough && sourceAudioProfile) {
    return AAC_PROFILE_CODECS[sourceAudioProfile] ?? "mp4a.40.2";
  }
  // When re-encoding with -c:a aac, ffmpeg defaults to AAC-LC
  return "mp4a.40.2";
}

export type VideoCodecStringOptions = Pick<
  import("@socialtip/asset-proxy-url-parser").ParsedUrl,
  "outputFormat" | "mute" | "resize" | "framerate"
> & {
  /** Source audio codec/profile from ffprobe. Undefined if the source has no audio track. */
  sourceAudio: AudioProbe | undefined;
};

/**
 * Build an RFC 6381 codec string for a video output based on the output format, dimensions, framerate, and source audio codec.
 *
 * For MP4/fMP4, produces H.264 High profile with a level computed from the output dimensions and framerate, plus an AAC audio codec (passthrough profile if source is AAC, otherwise AAC-LC from re-encoding).
 *
 * For WebM, produces AV1 Main profile with a computed level, plus Opus audio.
 *
 * Returns undefined for unrecognised output formats.
 */
export function videoCodecString(
  opts: VideoCodecStringOptions,
): string | undefined {
  const { outputFormat, mute, sourceAudio } = opts;
  const width = opts.resize?.width ?? 1920;
  const height = opts.resize?.height ?? 1080;
  const fps = opts.framerate ?? 30;
  if (outputFormat === "fmp4" || outputFormat === "mp4") {
    const video = h264CodecString(width, height, fps);
    const isPassthrough = sourceAudio?.codec === "aac";
    const audio = mute
      ? undefined
      : aacCodecString(sourceAudio?.profile, isPassthrough);
    return audio ? `${video}, ${audio}` : video;
  }
  if (outputFormat === "webm") {
    const video = av1CodecString(width, height, fps);
    const audio = mute ? undefined : "opus";
    return audio ? `${video}, ${audio}` : video;
  }
  return undefined;
}
