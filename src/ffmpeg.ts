import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { env } from "./env.js";
import type { OutputFormat, ResizingType } from "./url-parser.js";

export const gpuReady: Promise<boolean> = env.SKIP_GPU
  ? Promise.resolve(false)
  : new Promise((resolve) => {
      const proc = spawn("ffmpeg", [
        "-hide_banner",
        "-hwaccel",
        "cuda",
        "-f",
        "lavfi",
        "-i",
        "nullsrc=s=16x16:d=0.1",
        "-c:v",
        "h264_nvenc",
        "-f",
        "null",
        "-",
      ]);

      proc.on("close", (code) => {
        const available = code === 0;
        if (available) {
          console.log("GPU acceleration: enabled (NVENC)");
          resolve(true);
        } else {
          console.error(
            "GPU acceleration is required but not available. Set env.SKIP_GPU=1 to use CPU encoding.",
          );
          process.exit(1);
        }
      });

      proc.on("error", () => {
        console.error(
          "GPU acceleration is required but ffmpeg could not be started. Set env.SKIP_GPU=1 to use CPU encoding.",
        );
        process.exit(1);
      });
    });

interface ResizeParams {
  resizingType: ResizingType;
  width: number;
  height: number;
  outputFormat?: OutputFormat;
}

export async function resizeVideo(
  sourceUrl: string,
  { resizingType, width, height, outputFormat = "mp4" }: ResizeParams,
): Promise<Readable> {
  if (width <= 0 && height <= 0) {
    throw new Error("At least one of width or height must be specified");
  }

  const gpu = await gpuReady;
  const args = buildFfmpegArgs({
    sourceUrl,
    resizingType,
    width,
    height,
    gpu,
    outputFormat,
  });

  const proc = spawn("ffmpeg", args);

  let stderr = "";
  proc.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
    if (stderr.length > 10000) stderr = stderr.slice(-5000);
  });

  proc.on("close", (code) => {
    if (code !== 0) {
      console.error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`);
    }
  });

  proc.stdout.on("error", () => {
    proc.kill("SIGTERM");
  });

  return proc.stdout;
}

interface FfmpegArgsParams extends ResizeParams {
  sourceUrl: string;
  gpu: boolean;
}

function buildFfmpegArgs({
  sourceUrl,
  resizingType,
  width,
  height,
  gpu,
  outputFormat = "mp4",
}: FfmpegArgsParams): string[] {
  const args = ["-hide_banner", "-y"];

  if (gpu) {
    args.push("-hwaccel", "cuda", "-hwaccel_output_format", "cuda");
  }

  args.push("-i", sourceUrl);

  const filter = buildScaleFilter({ resizingType, width, height, gpu });
  args.push("-vf", filter);

  if (outputFormat === "webm") {
    args.push("-c:v", "libvpx-vp9");
    args.push("-c:a", "libopus");
    args.push("-f", "webm", "pipe:1");
  } else {
    if (gpu) {
      args.push("-c:v", "h264_nvenc", "-preset", "p4", "-tune", "hq");
    } else {
      args.push("-c:v", "libx264", "-preset", "fast");
    }
    args.push("-c:a", "copy");
    args.push("-movflags", "frag_keyframe+empty_moov+faststart");
    args.push("-f", "mp4", "pipe:1");
  }

  return args;
}

interface ScaleFilterParams {
  resizingType: ResizingType;
  width: number;
  height: number;
  gpu: boolean;
}

function buildScaleFilter({
  resizingType,
  width,
  height,
  gpu,
}: ScaleFilterParams): string {
  const scaleName = gpu ? "scale_cuda" : "scale";
  const w = width > 0 ? width : -1;
  const h = height > 0 ? height : -1;

  switch (resizingType) {
    case "fit":
      if (gpu) {
        return `${scaleName}=w='min(${width || 99999},iw*min(${width || 99999}/iw\\,${height || 99999}/ih))':h='min(${height || 99999},ih*min(${width || 99999}/iw\\,${height || 99999}/ih))'`;
      }
      return `${scaleName}=${w}:${h}:force_original_aspect_ratio=decrease`;

    case "fill":
      if (gpu) {
        return `${scaleName}=w='max(${width},iw*max(${width}/iw\\,${height}/ih))':h='max(${height},ih*max(${width}/iw\\,${height}/ih))',hwdownload,format=nv12,crop=${width}:${height},hwupload_cuda`;
      }
      return `${scaleName}=${w}:${h}:force_original_aspect_ratio=increase,crop=${width}:${height}`;

    case "fill-down":
      if (gpu) {
        return `${scaleName}=w='min(iw,max(${width},iw*max(${width}/iw\\,${height}/ih)))':h='min(ih,max(${height},ih*max(${width}/iw\\,${height}/ih)))',hwdownload,format=nv12,crop='min(${width},iw)':'min(${height},ih)',hwupload_cuda`;
      }
      return `${scaleName}=${w}:${h}:force_original_aspect_ratio=increase,crop='min(${width},iw)':'min(${height},ih)'`;

    case "force":
      return `${scaleName}=${width}:${height}`;

    case "auto":
      if (gpu) {
        return `hwdownload,format=nv12,scale=${w}:${h}:force_original_aspect_ratio='if(gt(dar,${width}/${height}),1,2)'`;
      }
      return `scale=${w}:${h}:force_original_aspect_ratio='if(gt(dar,${width}/${height}),1,2)'`;

    default:
      return `${scaleName}=${w}:${h}`;
  }
}
