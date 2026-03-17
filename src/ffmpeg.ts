import assert from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { env } from "./env.js";
import { HTTPError } from "./error.js";
import { logger } from "./logger.js";
import type {
  CompassGravity,
  Gravity,
  ImageFormat,
  ImageUrl,
  OutputFormat,
  ResizingAlgorithm,
  ResizingType,
  VideoUrl,
} from "./url-parser.js";

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
          logger.info("GPU acceleration: enabled (NVENC)");
          resolve(true);
        } else {
          logger.error(
            "GPU acceleration is required but not available. Set env.SKIP_GPU=1 to use CPU encoding.",
          );
          process.exit(1);
        }
      });

      proc.on("error", () => {
        logger.error(
          "GPU acceleration is required but ffmpeg could not be started. Set env.SKIP_GPU=1 to use CPU encoding.",
        );
        process.exit(1);
      });
    });

// ── Video processing ─────────────────────────────────────────────────────────

export async function processVideo(
  sourceUrl: string,
  parsed: VideoUrl,
): Promise<Readable> {
  if (!parsed.resize) {
    throw new HTTPError("Resize options are required for video processing", {
      code: "BAD_REQUEST",
    });
  }
  return runFfmpeg(
    buildVideoArgs(sourceUrl, {
      resizingType: parsed.resize.type,
      resizingAlgorithm: parsed.resizingAlgorithm,
      cropAspectRatio: parsed.cropAspectRatio,
      width: parsed.resize.width,
      height: parsed.resize.height,
      framerate: parsed.framerate,
      trim: parsed.trim,
      outputFormat: parsed.outputFormat,
      gpu: await gpuReady,
    }),
  );
}

// ── Image processing ─────────────────────────────────────────────────────────

export async function processImage(
  sourceUrl: string,
  parsed: ImageUrl,
): Promise<Buffer> {
  // AVIF muxer requires seekable output — use a temp file
  if (parsed.outputFormat === "avif") {
    const dir = mkdtempSync(join(tmpdir(), "asset-proxy-"));
    const outPath = join(dir, "output.avif");

    const args = buildImageArgs(sourceUrl, parsed, outPath);
    const stream = runFfmpeg(args);

    await new Promise<void>((resolve, reject) => {
      stream.on("end", resolve);
      stream.on("error", reject);
      stream.resume(); // drain stdout (will be empty since output goes to file)
    });

    const buffer = await readFile(outPath);
    await rm(dir, { recursive: true, force: true });
    return buffer;
  }

  const stream = runFfmpeg(buildImageArgs(sourceUrl, parsed));

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

// ── Shared ffmpeg runner ─────────────────────────────────────────────────────

function runFfmpeg(args: string[]): Readable {
  const proc = spawn("ffmpeg", args);

  let stderr = "";
  proc.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
    if (stderr.length > 10000) stderr = stderr.slice(-5000);
  });

  proc.on("close", (code) => {
    if (code !== 0) {
      logger.error("ffmpeg exited with non-zero code", {
        code,
        stderr: stderr.slice(-2000),
      });
    }
  });

  proc.stdout.on("error", () => {
    proc.kill("SIGTERM");
  });

  return proc.stdout;
}

// ── Video arg builder ────────────────────────────────────────────────────────

export interface VideoParams {
  resizingType: ResizingType;
  resizingAlgorithm?: ResizingAlgorithm;
  cropAspectRatio?: number;
  width: number;
  height: number;
  framerate?: number;
  trim?: number;
  outputFormat: OutputFormat;
  gpu: boolean;
}

/** @internal Exported for testing only. */
export function buildVideoArgs(
  sourceUrl: string,
  params: VideoParams,
): string[] {
  const {
    resizingType,
    resizingAlgorithm,
    cropAspectRatio,
    width,
    height,
    gpu,
    framerate,
    trim,
    outputFormat,
  } = params;

  // Build crop aspect ratio filter expression if needed
  const carFilter = cropAspectRatio
    ? `crop='if(gt(dar\\,${cropAspectRatio})\\,ih*${cropAspectRatio}\\,iw)':'if(gt(dar\\,${cropAspectRatio})\\,ih\\,iw/${cropAspectRatio})'`
    : "";
  const args = ["-hide_banner", "-y"];

  if (gpu) {
    args.push("-hwaccel", "cuda", "-hwaccel_output_format", "cuda");

    if (resizingAlgorithm?.mode === "gpu") {
      // Explicit GPU scaler — use -vf with the chosen scale filter
      args.push("-i", sourceUrl);
      const scaleFilter = buildScaleFilter({
        resizingType,
        resizingAlgorithm,
        width,
        height,
        gpu: true,
      });
      const vf = carFilter ? `${carFilter},${scaleFilter}` : scaleFilter;
      args.push("-vf", vf);
    } else if (resizingAlgorithm?.mode === "cpu") {
      throw new HTTPError(
        "CPU resizing algorithms are not supported with GPU acceleration — use gpu:scale_cuda or gpu:scale_npp, or disable GPU",
        { code: "BAD_REQUEST" },
      );
    } else {
      // Default cuvid resize via -resize decoder flag (force mode only)
      if (resizingType !== "force") {
        throw new HTTPError(
          `Resize type '${resizingType}' is not supported with default GPU resize — specify ra:gpu:scale_cuda or ra:gpu:scale_npp for ${resizingType} mode`,
          { code: "BAD_REQUEST" },
        );
      }
      if (width <= 0 || height <= 0) {
        throw new HTTPError(
          "Both width and height are required for default GPU resize",
          { code: "BAD_REQUEST" },
        );
      }
      args.push("-resize", `${width}x${height}`);
      args.push("-i", sourceUrl);
      if (carFilter) {
        args.push("-vf", carFilter);
      }
    }
  } else {
    args.push("-i", sourceUrl);
    const scaleFilter = buildScaleFilter({
      resizingType,
      resizingAlgorithm,
      width,
      height,
      gpu: false,
    });
    const vf = carFilter ? `${carFilter},${scaleFilter}` : scaleFilter;
    args.push("-vf", vf);
  }

  if (trim !== undefined) {
    args.push("-t", String(trim));
  }

  if (framerate !== undefined) {
    args.push("-r", String(framerate));
  }

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

// ── Image arg builder ────────────────────────────────────────────────────────

function buildImageArgs(
  sourceUrl: string,
  parsed: ImageUrl,
  outputPath?: string,
): string[] {
  const args = ["-hide_banner", "-y", "-i", sourceUrl];
  const filters: string[] = [];

  // Crop (before resize, per imgproxy behaviour)
  if (parsed.crop && (parsed.crop.width > 0 || parsed.crop.height > 0)) {
    const cw = Math.round(parsed.crop.width);
    const ch = Math.round(parsed.crop.height);
    const g = parsed.crop.gravity ?? parsed.gravity;
    const { x, y } = gravityOffsets(g, cw, ch);
    filters.push(`crop=${cw}:${ch}:${x}:${y}`);
  }

  // Crop to aspect ratio
  if (parsed.cropAspectRatio) {
    const r = parsed.cropAspectRatio;
    // If source is wider than target ratio, crop width; otherwise crop height
    filters.push(
      `crop='if(gt(dar\\,${r})\\,ih*${r}\\,iw)':'if(gt(dar\\,${r})\\,ih\\,iw/${r})'`,
    );
  }

  // Resize
  if (parsed.resize && (parsed.resize.width > 0 || parsed.resize.height > 0)) {
    filters.push(
      buildScaleFilter({
        resizingType: parsed.resize.type,
        resizingAlgorithm: parsed.resizingAlgorithm,
        width: parsed.resize.width,
        height: parsed.resize.height,
        gpu: false,
      }),
    );
  }

  // Min width / min height — ensure output is at least this large
  if (parsed.minWidth && parsed.minWidth > 0) {
    filters.push(
      `scale=max(iw\\,${parsed.minWidth}):ih:force_original_aspect_ratio=increase`,
    );
  }
  if (parsed.minHeight && parsed.minHeight > 0) {
    filters.push(
      `scale=iw:max(ih\\,${parsed.minHeight}):force_original_aspect_ratio=increase`,
    );
  }

  // Extend — pad undersized images to fill target dimensions
  if (parsed.extend?.enabled && parsed.resize) {
    const tw = parsed.resize.width || 0;
    const th = parsed.resize.height || 0;
    if (tw > 0 || th > 0) {
      const w = tw > 0 ? String(tw) : "iw";
      const h = th > 0 ? String(th) : "ih";
      const colour = parsed.background
        ? rgbToHex(parsed.background)
        : "black@0";
      filters.push(`pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:${colour}`);
    }
  }

  // Rotate
  if (parsed.rotate) {
    switch (parsed.rotate) {
      case 90:
        filters.push("transpose=1");
        break;
      case 180:
        filters.push("hflip,vflip");
        break;
      case 270:
        filters.push("transpose=2");
        break;
    }
  }

  // Blur
  if (parsed.blur && parsed.blur > 0) {
    filters.push(`gblur=sigma=${parsed.blur}`);
  }

  // Sharpen
  if (parsed.sharpen && parsed.sharpen > 0) {
    const s = parsed.sharpen;
    filters.push(`unsharp=5:5:${s}:5:5:0`);
  }

  // Padding with background
  if (parsed.padding) {
    const { top, right, bottom, left } = parsed.padding;
    const colour = parsed.background ? rgbToHex(parsed.background) : "black@0";
    // pad adds to dimensions: new_w = in_w + left + right, new_h = in_h + top + bottom
    filters.push(
      `pad=iw+${left + right}:ih+${top + bottom}:${left}:${top}:${colour}`,
    );
  }

  // AVIF (YUV420) requires even dimensions
  if (parsed.outputFormat === "avif") {
    filters.push("pad=ceil(iw/2)*2:ceil(ih/2)*2");
  }

  if (filters.length > 0) {
    args.push("-vf", filters.join(","));
  }

  // Strip metadata
  if (parsed.stripMetadata !== false) {
    args.push("-map_metadata", "-1");
  }

  // Output format and codec
  args.push("-frames:v", "1");
  appendImageOutputArgs(args, parsed.outputFormat, parsed.quality);
  args.push(outputPath ?? "pipe:1");

  return args;
}

function appendImageOutputArgs(
  args: string[],
  format: ImageFormat,
  quality?: number,
): void {
  switch (format) {
    case "jpg":
      args.push("-f", "image2", "-c:v", "mjpeg");
      if (quality !== undefined) {
        // ffmpeg mjpeg uses qscale 2-31 (2=best), map 1-100 → 31-2
        args.push("-q:v", String(Math.round(31 - (quality / 100) * 29)));
      }
      break;
    case "png":
      args.push("-f", "image2", "-c:v", "png");
      break;
    case "webp":
      args.push("-f", "webp", "-c:v", "libwebp");
      if (quality !== undefined) {
        args.push("-quality", String(quality));
      }
      break;
    case "avif":
      args.push("-f", "avif", "-c:v", "libaom-av1", "-still-picture", "1");
      if (quality !== undefined) {
        // libaom-av1 uses crf 0-63 (0=best), map 1-100 → 63-0
        args.push("-crf", String(Math.round(63 - (quality / 100) * 63)));
      }
      break;
    case "gif":
      args.push("-f", "gif");
      break;
  }
}

function rgbToHex(c: { r: number; g: number; b: number }): string {
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
}

/** Return ffmpeg crop x:y offset expressions for the given gravity. */
function gravityOffsets(
  g: Gravity | undefined,
  cw: number,
  ch: number,
): { x: string; y: string } {
  if (!g) return { x: "(iw-ow)/2", y: "(ih-oh)/2" }; // centre default

  if (typeof g === "object" && g.type === "fp") {
    // Focus point: centre crop on (x, y) fraction, clamped to image bounds
    return {
      x: `min(max(iw*${g.x}-${cw}/2\\,0)\\,iw-${cw})`,
      y: `min(max(ih*${g.y}-${ch}/2\\,0)\\,ih-${ch})`,
    };
  }

  const compass = g as CompassGravity;
  const cx = "(iw-ow)/2";
  const cy = "(ih-oh)/2";
  switch (compass) {
    case "ce":
      return { x: cx, y: cy };
    case "no":
      return { x: cx, y: "0" };
    case "so":
      return { x: cx, y: "ih-oh" };
    case "ea":
      return { x: "iw-ow", y: cy };
    case "we":
      return { x: "0", y: cy };
    case "noea":
      return { x: "iw-ow", y: "0" };
    case "nowe":
      return { x: "0", y: "0" };
    case "soea":
      return { x: "iw-ow", y: "ih-oh" };
    case "sowe":
      return { x: "0", y: "ih-oh" };
    default:
      return { x: cx, y: cy };
  }
}

// ── Shared scale filter builder ──────────────────────────────────────────────

interface ScaleFilterParams {
  resizingType: ResizingType;
  resizingAlgorithm?: ResizingAlgorithm;
  width: number;
  height: number;
  gpu: boolean;
}

const CPU_ALGORITHM_FLAGS: Record<string, string> = {
  nearest: "neighbor",
  linear: "bilinear",
  cubic: "bicubic",
  lanczos2: "lanczos",
  lanczos3: "lanczos",
};

const NPP_INTERP_ALGO: Record<string, string> = {
  nearest: "nn",
  linear: "linear",
  cubic: "cubic",
  lanczos2: "lanczos",
  lanczos3: "lanczos",
};

function buildScaleFilter({
  resizingType,
  resizingAlgorithm,
  width,
  height,
  gpu,
}: ScaleFilterParams): string {
  const w = width > 0 ? width : -1;
  const h = height > 0 ? height : -1;

  // Determine scale filter name and algorithm suffix
  let scaleName: string;
  let flagsSuffix = "";

  if (gpu) {
    // Only called with an explicit GPU scaler (cuvid default is handled via -resize in buildVideoArgs)
    assert(
      resizingAlgorithm?.mode === "gpu",
      "buildScaleFilter with gpu=true requires an explicit GPU scaler",
    );
    scaleName = resizingAlgorithm.scaler;
    if (resizingAlgorithm.algorithm) {
      flagsSuffix = `:interp_algo=${NPP_INTERP_ALGO[resizingAlgorithm.algorithm]}`;
    }
  } else {
    if (resizingAlgorithm?.mode === "gpu") {
      throw new HTTPError(
        "GPU resizing algorithms (gpu:*) are only available for video processing with GPU acceleration — use CPU algorithms for image thumbnails",
        { code: "BAD_REQUEST" },
      );
    }
    scaleName = "scale";
    if (resizingAlgorithm?.mode === "cpu") {
      flagsSuffix = `:flags=${CPU_ALGORITHM_FLAGS[resizingAlgorithm.algorithm]}`;
    }
  }

  switch (resizingType) {
    case "fit":
      if (gpu) {
        return `${scaleName}=w='min(${width || 99999},iw*min(${width || 99999}/iw\\,${height || 99999}/ih))':h='min(${height || 99999},ih*min(${width || 99999}/iw\\,${height || 99999}/ih))'${flagsSuffix}`;
      }
      return `${scaleName}=${w}:${h}:force_original_aspect_ratio=decrease${flagsSuffix}`;

    case "fill":
      if (gpu) {
        return `${scaleName}=w='max(${width},iw*max(${width}/iw\\,${height}/ih))':h='max(${height},ih*max(${width}/iw\\,${height}/ih))'${flagsSuffix},hwdownload,format=nv12,crop=${width}:${height},hwupload_cuda`;
      }
      return `${scaleName}=${w}:${h}:force_original_aspect_ratio=increase${flagsSuffix},crop=${width}:${height}`;

    case "fill-down":
      if (gpu) {
        return `${scaleName}=w='min(iw,max(${width},iw*max(${width}/iw\\,${height}/ih)))':h='min(ih,max(${height},ih*max(${width}/iw\\,${height}/ih)))'${flagsSuffix},hwdownload,format=nv12,crop='min(${width},iw)':'min(${height},ih)',hwupload_cuda`;
      }
      return `${scaleName}=${w}:${h}:force_original_aspect_ratio=increase${flagsSuffix},crop='min(${width},iw)':'min(${height},ih)'`;

    case "force":
      return `${scaleName}=${width}:${height}${flagsSuffix}`;

    case "auto":
      if (gpu) {
        return `hwdownload,format=nv12,scale=${w}:${h}:force_original_aspect_ratio='if(gt(dar,${width}/${height}),1,2)'${flagsSuffix}`;
      }
      return `scale=${w}:${h}:force_original_aspect_ratio='if(gt(dar,${width}/${height}),1,2)'${flagsSuffix}`;

    default:
      return `${scaleName}=${w}:${h}${flagsSuffix}`;
  }
}
