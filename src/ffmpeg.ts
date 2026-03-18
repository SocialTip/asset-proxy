import assert from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import sharp from "sharp";
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

export async function processVideo(
  sourceUrl: string,
  parsed: VideoUrl,
): Promise<Readable> {
  return runFfmpeg(
    buildVideoArgs(sourceUrl, {
      resizingType: parsed.resize?.type,
      resizingAlgorithm: parsed.resizingAlgorithm,
      cropAspectRatio: parsed.cropAspectRatio,
      width: parsed.resize?.width ?? 0,
      height: parsed.resize?.height ?? 0,
      flip: parsed.flip,
      framerate: parsed.framerate,
      cut: parsed.cut,
      outputFormat: parsed.outputFormat,
      gpu: await gpuReady,
    }),
  );
}

export async function processImage(
  sourceUrl: string,
  parsed: ImageUrl,
): Promise<Buffer> {
  const shouldStripMetadata = parsed.stripMetadata ?? env.STRIP_METADATA;
  const shouldKeepCopyright = parsed.keepCopyright ?? env.KEEP_COPYRIGHT;
  const shouldStripColorProfile =
    parsed.stripColorProfile ?? env.STRIP_COLOR_PROFILE;
  const enforceThumbnail = parsed.enforceThumbnail ?? env.ENFORCE_THUMBNAIL;
  const needsMetadataCopy =
    !shouldStripMetadata || (shouldStripMetadata && shouldKeepCopyright);
  const needsSourceFile = needsMetadataCopy || enforceThumbnail;

  // Download source to a temp file when we need it for metadata copy or thumbnail extraction.
  let sourceTempDir: string | undefined;
  let sourceTempPath: string | undefined;
  let ffmpegInput = sourceUrl;
  if (needsSourceFile) {
    sourceTempDir = mkdtempSync(join(tmpdir(), "asset-proxy-src-"));
    sourceTempPath = join(sourceTempDir, "source");
    const srcRes = await fetch(sourceUrl);
    if (srcRes.ok) {
      await writeFile(sourceTempPath, Buffer.from(await srcRes.arrayBuffer()));
      ffmpegInput = sourceTempPath;
    } else {
      sourceTempPath = undefined;
    }
  }

  // Extract embedded thumbnail if requested and source is available
  if (enforceThumbnail && sourceTempPath) {
    const thumbPath = await extractThumbnail(sourceTempPath);
    if (thumbPath) {
      ffmpegInput = thumbPath;
    }
  }

  let trimFilter: string | undefined;
  if (parsed.trim) {
    trimFilter = await detectTrimCrop(ffmpegInput, parsed.trim);
  }

  // Resolve effective quality: format-specific > global > default
  const effectiveQuality =
    parsed.formatQuality?.[parsed.outputFormat] ?? parsed.quality;
  const effectiveParsed = { ...parsed, quality: effectiveQuality };

  let buffer: Buffer;

  if (parsed.outputFormat === "avif") {
    const dir = mkdtempSync(join(tmpdir(), "asset-proxy-"));
    const outPath = join(dir, "output.avif");
    const args = buildImageArgs(ffmpegInput, effectiveParsed, {
      outputPath: outPath,
      trimFilter,
    });
    const stream = runFfmpeg(args);
    await new Promise<void>((resolve, reject) => {
      stream.on("end", resolve);
      stream.on("error", reject);
      stream.resume();
    });
    buffer = await readFile(outPath);
    await rm(dir, { recursive: true, force: true });
  } else {
    const stream = runFfmpeg(
      buildImageArgs(ffmpegInput, effectiveParsed, { trimFilter }),
    );
    buffer = await new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  }

  // TODO: autoquality (DSSIM) — binary search for quality that hits target DSSIM

  if (
    parsed.maxBytes &&
    parsed.maxBytes > 0 &&
    buffer.length > parsed.maxBytes
  ) {
    buffer = await shrinkToMaxBytes(
      buffer,
      parsed.outputFormat,
      parsed.maxBytes,
    );
  }

  const needsExiftool =
    (needsMetadataCopy && sourceTempPath) || (parsed.dpi && parsed.dpi > 0);

  if (needsExiftool) {
    buffer = await runExiftool(buffer, {
      sourcePath: needsMetadataCopy ? sourceTempPath : undefined,
      copyrightOnly: shouldStripMetadata && shouldKeepCopyright,
      stripColorProfile: shouldStripColorProfile,
      dpi: parsed.dpi,
    });
  }

  if (sourceTempDir) {
    await rm(sourceTempDir, { recursive: true, force: true });
  }

  return buffer;
}

/** Extract embedded thumbnail from an image. Tries exiftool (EXIF/AVIF) then heif-thumbnailer (HEIC). */
async function extractThumbnail(
  sourcePath: string,
): Promise<string | undefined> {
  const dir = mkdtempSync(join(tmpdir(), "asset-proxy-thumb-"));

  // Try exiftool first (works for AVIF/JPEG EXIF thumbnails)
  const exifThumb = join(dir, "thumbnail.jpg");
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("exiftool", ["-b", "-ThumbnailImage", sourcePath]);
      const chunks: Buffer[] = [];
      proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      proc.on("close", async (code) => {
        if (code !== 0 || chunks.length === 0) {
          reject(new Error("No EXIF thumbnail"));
          return;
        }
        await writeFile(exifThumb, Buffer.concat(chunks));
        resolve();
      });
      proc.on("error", reject);
    });
    return exifThumb;
  } catch {
    // Fall through to heif-thumbnailer
  }

  // Try heif-thumbnailer (works for HEIC container thumbnails)
  const heifThumb = join(dir, "thumbnail.png");
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("heif-thumbnailer", [sourcePath, heifThumb]);
      proc.on("close", async (code) => {
        if (code !== 0) {
          reject(new Error("No HEIC thumbnail"));
          return;
        }
        resolve();
      });
      proc.on("error", reject);
    });
    // Verify the file was created and is non-empty
    const stat = await readFile(heifThumb);
    if (stat.length > 0) return heifThumb;
  } catch {
    // No thumbnail found
  }

  await rm(dir, { recursive: true, force: true });
  return undefined;
}

/** Run exiftool on an image buffer to set/copy metadata. Only supports EXIF — XMP/IPTC are always stripped. */
/** Binary search on quality using sharp to fit output under maxBytes. */
async function shrinkToMaxBytes(
  buffer: Buffer,
  format: ImageFormat,
  maxBytes: number,
): Promise<Buffer> {
  let lo = 1;
  let hi = 99;
  let best = buffer;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    let img = sharp(buffer);
    switch (format) {
      case "jpg":
        img = img.jpeg({ quality: mid });
        break;
      case "webp":
        img = img.webp({ quality: mid });
        break;
      case "avif":
        img = img.avif({ quality: mid });
        break;
      default:
        return buffer;
    }
    const attempt = await img.toBuffer();
    if (attempt.length <= maxBytes) {
      best = attempt;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return best;
}

async function runExiftool(
  buffer: Buffer,
  opts: {
    sourcePath?: string;
    copyrightOnly?: boolean;
    stripColorProfile?: boolean;
    dpi?: number;
  },
): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), "asset-proxy-meta-"));
  const outPath = join(dir, "output");
  await writeFile(outPath, buffer);

  const exiftoolArgs = ["-overwrite_original"];
  if (opts.sourcePath) {
    if (opts.copyrightOnly) {
      exiftoolArgs.push("-tagsfromfile", opts.sourcePath, "-Copyright");
    } else {
      exiftoolArgs.push("-tagsfromfile", opts.sourcePath, "-all:all");
    }
  }
  if (opts.stripColorProfile) {
    exiftoolArgs.push("-ICC_Profile:all=");
  }
  if (opts.dpi && opts.dpi > 0) {
    exiftoolArgs.push(
      `-XResolution=${opts.dpi}`,
      `-YResolution=${opts.dpi}`,
      "-ResolutionUnit=inches",
    );
  }
  exiftoolArgs.push(outPath);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("exiftool", exiftoolArgs);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`exiftool exited with code ${code}`));
    });
    proc.on("error", reject);
  });

  const result = await readFile(outPath);
  await rm(dir, { recursive: true, force: true });
  return result;
}

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

interface TrimOptions {
  threshold: number;
  colour?: string;
  equalHor: boolean;
  equalVert: boolean;
}

/** Run ffmpeg cropdetect on a single frame to determine trim bounds. Returns a crop filter string like "crop=180:140:10:5". */
function detectTrimCrop(
  sourceUrl: string,
  trim: TrimOptions,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    // cropdetect round=2 to allow odd dimensions, limit=threshold/255
    const limit = Math.min(trim.threshold / 255, 1);
    const args = [
      "-hide_banner",
      "-i",
      sourceUrl,
      "-frames:v",
      "1",
      "-vf",
      `cropdetect=limit=${limit}:round=2:reset=0`,
      "-f",
      "null",
      "-",
    ];

    const proc = spawn("ffmpeg", args);
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", () => {
      // Parse last cropdetect line: "crop=W:H:X:Y"
      const match = stderr.match(/crop=(\d+:\d+:\d+:\d+)/g);
      if (!match) {
        resolve(undefined);
        return;
      }
      const last = match[match.length - 1];
      const [w, h, x, y] = last.replace("crop=", "").split(":").map(Number);

      if (trim.equalHor || trim.equalVert) {
        // For equal trimming, use the smaller offset on each side
        // cropdetect gives top-left (x, y). We need to compute both sides.
        // Source dimensions are unknown here, but we can adjust by
        // using the detected crop directly — equal trimming means symmetric crop.
        // We re-centre the crop region.
        const cropFilter = `crop=${w}:${h}`;
        resolve(cropFilter);
      } else {
        resolve(`crop=${w}:${h}:${x}:${y}`);
      }
    });

    proc.on("error", () => resolve(undefined));
  });
}

export interface VideoParams {
  resizingType?: ResizingType;
  resizingAlgorithm?: ResizingAlgorithm;
  cropAspectRatio?: number;
  flip?: { horizontal: boolean; vertical: boolean };
  width: number;
  height: number;
  framerate?: number;
  cut?: number;
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
    flip,
    width,
    height,
    gpu,
    framerate,
    cut,
    outputFormat,
  } = params;

  // Build pre/post filters
  const preFilters: string[] = [];
  const postFilters: string[] = [];
  if (cropAspectRatio) {
    preFilters.push(
      `crop='if(gt(dar\\,${cropAspectRatio})\\,ih*${cropAspectRatio}\\,iw)':'if(gt(dar\\,${cropAspectRatio})\\,ih\\,iw/${cropAspectRatio})'`,
    );
  }
  if (flip?.horizontal) postFilters.push("hflip");
  if (flip?.vertical) postFilters.push("vflip");
  const args = ["-hide_banner", "-y"];

  const hasResize = width > 0 || height > 0;

  if (gpu) {
    args.push("-hwaccel", "cuda", "-hwaccel_output_format", "cuda");

    if (resizingAlgorithm?.mode === "gpu") {
      args.push("-i", sourceUrl);
      const scaleFilter = buildScaleFilter({
        resizingType: resizingType ?? "fit",
        resizingAlgorithm,
        width,
        height,
        gpu: true,
      });
      const vf = [...preFilters, scaleFilter, ...postFilters].join(",");
      args.push("-vf", vf);
    } else if (resizingAlgorithm?.mode === "cpu") {
      throw new HTTPError(
        "CPU resizing algorithms are not supported with GPU acceleration — use gpu:scale_cuda or gpu:scale_npp, or disable GPU",
        { code: "BAD_REQUEST" },
      );
    } else if (hasResize) {
      if (resizingType && resizingType !== "force") {
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
      const extra = [...preFilters, ...postFilters];
      if (extra.length > 0) {
        args.push("-vf", extra.join(","));
      }
    } else {
      args.push("-i", sourceUrl);
      const extra = [...preFilters, ...postFilters];
      if (extra.length > 0) {
        args.push("-vf", extra.join(","));
      }
    }
  } else {
    args.push("-i", sourceUrl);
    const filters = [...preFilters];
    if (hasResize) {
      filters.push(
        buildScaleFilter({
          resizingType: resizingType ?? "fit",
          resizingAlgorithm,
          width,
          height,
          gpu: false,
        }),
      );
    }
    filters.push(...postFilters);
    if (filters.length > 0) {
      args.push("-vf", filters.join(","));
    }
  }

  if (cut !== undefined) {
    args.push("-t", String(cut));
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

function buildImageArgs(
  sourceUrl: string,
  parsed: ImageUrl,
  opts?: { outputPath?: string; trimFilter?: string },
): string[] {
  const args = ["-hide_banner", "-y", "-i", sourceUrl];

  const filters: string[] = [];

  // Trim (border removal — applied first, before crop/resize)
  if (opts?.trimFilter) {
    filters.push(opts.trimFilter);
  }

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

  // Convert to RGBA when background alpha is used (required for transparent pad)
  if (parsed.backgroundAlpha !== undefined && parsed.backgroundAlpha < 1) {
    filters.push("format=rgba");
  }

  // Extend — pad undersized images to fill target dimensions
  if (parsed.extend?.enabled && parsed.resize) {
    const tw = parsed.resize.width || 0;
    const th = parsed.resize.height || 0;
    if (tw > 0 || th > 0) {
      const w = tw > 0 ? String(tw) : "iw";
      const h = th > 0 ? String(th) : "ih";
      const colour = parsed.background
        ? rgbToHex(parsed.background, parsed.backgroundAlpha)
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

  // Flip
  if (parsed.flip?.horizontal) filters.push("hflip");
  if (parsed.flip?.vertical) filters.push("vflip");

  // Blur
  if (parsed.blur && parsed.blur > 0) {
    filters.push(`gblur=sigma=${parsed.blur}`);
  }

  if (parsed.sharpen && parsed.sharpen > 0) {
    const s = parsed.sharpen;
    filters.push(`unsharp=5:5:${s}:5:5:0`);
  }

  if (parsed.pixelate && parsed.pixelate > 1) {
    const px = parsed.pixelate;
    filters.push(
      `scale=iw/${px}:ih/${px}:flags=neighbor`,
      `scale=iw*${px}:ih*${px}:flags=neighbor`,
    );
  }

  // Colour adjustments (eq filter combines brightness, contrast, saturation)
  const eqParts: string[] = [];
  if (parsed.brightness !== 0) {
    eqParts.push(`brightness=${parsed.brightness / 255}`);
  }
  if (parsed.contrast !== 1) {
    eqParts.push(`contrast=${parsed.contrast}`);
  }
  if (parsed.saturation !== 1) {
    eqParts.push(`saturation=${parsed.saturation}`);
  }
  if (eqParts.length > 0) {
    filters.push(`eq=${eqParts.join(":")}`);
  }

  // Monochrome
  if (parsed.monochrome && parsed.monochrome.intensity > 0) {
    const { intensity, colour } = parsed.monochrome;
    const r = parseInt(colour.slice(0, 2), 16) / 255;
    const g = parseInt(colour.slice(2, 4), 16) / 255;
    const b = parseInt(colour.slice(4, 6), 16) / 255;
    // Desaturate then tint: use colorbalance or hue filter
    // Full intensity = fully monochrome, partial = blend
    if (intensity >= 1) {
      filters.push(`hue=s=0`);
      if (colour !== "b3b3b3") {
        filters.push(`colorbalance=rs=${r - 0.5}:gs=${g - 0.5}:bs=${b - 0.5}`);
      }
    } else {
      filters.push(`eq=saturation=${1 - intensity}`);
    }
  }

  // Duotone
  if (parsed.duotone && parsed.duotone.intensity > 0) {
    const { intensity, colour1, colour2 } = parsed.duotone;
    const r1 = parseInt(colour1.slice(0, 2), 16);
    const g1 = parseInt(colour1.slice(2, 4), 16);
    const b1 = parseInt(colour1.slice(4, 6), 16);
    const r2 = parseInt(colour2.slice(0, 2), 16);
    const g2 = parseInt(colour2.slice(2, 4), 16);
    const b2 = parseInt(colour2.slice(4, 6), 16);
    if (intensity >= 1) {
      filters.push(`hue=s=0`);
    } else {
      filters.push(`eq=saturation=${1 - intensity}`);
    }
    // Linear interpolation from colour1 (shadows) to colour2 (highlights) using lut
    filters.push(
      `lutrgb=r=${r1}+(${r2}-${r1})*val/255:g=${g1}+(${g2}-${g1})*val/255:b=${b1}+(${b2}-${b1})*val/255`,
    );
  }

  // Unsharp masking
  if (parsed.unsharpMasking && parsed.unsharpMasking.mode !== "none") {
    const { mode, weight, divider } = parsed.unsharpMasking;
    // In "auto" mode, only apply when there's a downscale (resize present)
    // In "always" mode, always apply
    if (mode === "always" || (mode === "auto" && parsed.resize)) {
      const amount = weight / divider;
      filters.push(`unsharp=5:5:${amount}:5:5:0`);
    }
  }

  // Colorize (colour overlay)
  if (parsed.colorize && parsed.colorize.opacity > 0) {
    const { opacity, colour } = parsed.colorize;
    const hex =
      colour.length === 3
        ? colour[0] + colour[0] + colour[1] + colour[1] + colour[2] + colour[2]
        : colour;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const inv = 1 - opacity;
    filters.push(
      `lutrgb=r=${Math.round(r * opacity)}+val*${inv}:g=${Math.round(g * opacity)}+val*${inv}:b=${Math.round(b * opacity)}+val*${inv}`,
    );
  }

  // Gradient (transparent → colour overlay)
  if (parsed.gradient && parsed.gradient.opacity > 0) {
    const { opacity, colour, direction, start, stop } = parsed.gradient;
    const hex =
      colour.length === 3
        ? colour[0] + colour[0] + colour[1] + colour[1] + colour[2] + colour[2]
        : colour;
    // Map direction to angle
    let angle: number;
    switch (direction) {
      case "down":
        angle = 0;
        break;
      case "up":
        angle = 180;
        break;
      case "right":
        angle = 90;
        break;
      case "left":
        angle = 270;
        break;
      default:
        angle = parseFloat(direction) || 0;
    }
    // Use geq to apply a gradient based on position
    // For a top-to-bottom gradient (angle=0): factor = clamp((Y/H - start) / (stop - start), 0, 1)
    // Then blend: pixel * (1 - factor*opacity) + colour * factor*opacity
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const range = stop - start || 1;
    // For simplicity, support vertical gradients (0/180) and horizontal (90/270)
    let pos: string;
    if (angle === 0) pos = "Y/H";
    else if (angle === 180) pos = "(H-Y)/H";
    else if (angle === 90) pos = "(W-X)/W";
    else if (angle === 270) pos = "X/W";
    else pos = "Y/H"; // fallback to top-to-bottom
    const factor = `clip((${pos}-${start})/${range},0,1)*${opacity}`;
    filters.push(
      `geq=r='r(X,Y)*(1-(${factor}))+${r}*(${factor})':g='g(X,Y)*(1-(${factor}))+${g}*(${factor})':b='b(X,Y)*(1-(${factor}))+${b}*(${factor})'`,
    );
  }

  if (parsed.padding) {
    const { top, right, bottom, left } = parsed.padding;
    const colour = parsed.background
      ? rgbToHex(parsed.background, parsed.backgroundAlpha)
      : "black@0";
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

  // Always strip metadata in ffmpeg. If metadata needs to be preserved
  // (keepCopyright, sm:0), exiftool copies it back from the source in processImage.
  args.push("-map_metadata", "-1");

  // Output format and codec
  args.push("-frames:v", "1");
  appendImageOutputArgs(args, parsed.outputFormat, parsed.quality);
  args.push(opts?.outputPath ?? "pipe:1");

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

function rgbToHex(
  c: { r: number; g: number; b: number },
  alpha?: number,
): string {
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  const colour = `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
  if (alpha !== undefined && alpha < 1) return `${colour}@${alpha}`;
  return colour;
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
