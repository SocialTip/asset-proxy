import assert from "node:assert";
import { spawn } from "node:child_process";
import { createReadStream, mkdtempSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, type Readable } from "node:stream";

import sharp from "sharp";

import { env as envSwitched, isCacheMode, type ProcessingEnv } from "./env.js";
import { FifoSemaphore } from "./fifo-semaphore.js";

const env = envSwitched as ProcessingEnv;
import {
  type CompassGravity,
  type Gravity,
  HTTPError,
  type ImageFormat,
  type ImageUrl,
  type OutputFormat,
  type ParsedUrl,
  type ResizingAlgorithm,
  type ResizingType,
  type VideoUrl,
} from "@socialtip/asset-proxy-url-parser";

import { videoCodecString } from "./codec.js";
import { probeSource } from "./ffprobe.js";
import { logger } from "./logger.js";
import { recordException, tracer } from "./tracing.js";

export const gpuReady: Promise<boolean> =
  isCacheMode(envSwitched) || env.SKIP_GPU
    ? Promise.resolve(false)
    : new Promise((resolve) => {
        const proc = spawn("ffmpeg", [
          "-hide_banner",
          "-hwaccel",
          "cuda",
          "-f",
          "lavfi",
          "-i",
          `nullsrc=s=${env.GPU_MIN_FRAME_SIZE.width}x${env.GPU_MIN_FRAME_SIZE.height}:d=0.1`,
          "-c:v",
          "h264_nvenc",
          "-f",
          "null",
          "-",
        ]);

        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        proc.stdout.on("data", (chunk) => stdout.push(chunk));
        proc.stderr.on("data", (chunk) => stderr.push(chunk));

        proc.on("close", (code) => {
          const available = code === 0;
          if (available) {
            logger.info("GPU acceleration: enabled (NVENC)");
            resolve(true);
          } else {
            logger.error(
              "GPU acceleration is required but not available. Set env.SKIP_GPU=1 to use CPU encoding.",
              {
                stdout: Buffer.concat(stdout).toString(),
                stderr: Buffer.concat(stderr).toString(),
                exitCode: code,
              },
            );
            process.exit(1);
          }
        });

        proc.on("error", (err) => {
          logger.error(
            "GPU acceleration is required but ffmpeg could not be started. Set env.SKIP_GPU=1 to use CPU encoding.",
            { err },
          );
          process.exit(1);
        });
      });

/** Acquire a lock on the GPU. Concurrency is limited by the `GPU_CONCURRENCY` env var. Returns a `Disposable` so it can be used with `using` for automatic release, or disposed manually for streaming responses. Throws HTTP 429 with a `Retry-After` header if the lock cannot be acquired within `GPU_ACQUIRE_TIMEOUT_MS` milliseconds. `undefined` when GPU is disabled (cache mode or `SKIP_GPU=1`).
 *
 * ```typescript
 * // Buffered output (MP4): automatic release via `using`
 * {
 *   using _lock = await acquireGpuLock();
 *   return await encodeMp4(...);
 * }
 *
 * // Streaming output (WebM): manual release on stream close
 * const lock = await acquireGpuLock();
 * const stream = runFfmpeg(args);
 * stream.on("close", () => lock[Symbol.dispose]());
 * return { stream };
 * ```
 */
const acquireGpuLock: (key: string) => Promise<Disposable> = (() => {
  const concurrencyLimit =
    isCacheMode(envSwitched) || env.SKIP_GPU ? 0 : env.GPU_CONCURRENCY;
  const timeoutMs = env.GPU_ACQUIRE_TIMEOUT_MS;
  const semaphore = new FifoSemaphore(concurrencyLimit);

  return async (key: string) => {
    const result = semaphore.acquire(key);
    if (result.acquired) {
      return { [Symbol.dispose]: result.release };
    }

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => {
        result.cancel();
        reject(
          new HTTPError("GPU busy, try again later", {
            code: "TOO_MANY_REQUESTS",
            headers: { "Retry-After": "5" },
          }),
        );
      }, timeoutMs);
    });

    return Promise.race([
      result.waiter.then((release) => ({ [Symbol.dispose]: release })),
      timeout,
    ]);
  };
})();

/** Options that are only supported for image processing, not video. */
const IMAGE_ONLY_OPTIONS: [keyof ParsedUrl, string][] = [
  ["trim", "trim"],
  ["blur", "blur"],
  ["sharpen", "sharpen"],
  ["rotate", "rotate"],
  ["padding", "padding"],
  ["autoquality", "autoquality"],
  ["dpi", "dpi"],
  ["enforceThumbnail", "enforce_thumbnail"],
  ["crop", "crop"],
  ["enlarge", "enlarge"],
  ["minWidth", "min_width"],
  ["minHeight", "min_height"],
  ["extend", "extend"],
  ["extendAspectRatio", "extend_aspect_ratio"],
  ["pixelate", "pixelate"],
  ["unsharpMasking", "unsharp_masking"],
  ["colorize", "colorize"],
  ["gradient", "gradient"],
  ["monochrome", "monochrome"],
  ["duotone", "duotone"],
  ["jpegOptions", "jpeg_options"],
  ["pngOptions", "png_options"],
  ["webpOptions", "webp_options"],
  ["avifOptions", "avif_options"],
];

function rejectImageOnlyOptions(parsed: ParsedUrl) {
  const hint =
    " — use video_thumbnail_second (vts) to extract a frame first, or specify an image output format";
  for (const [key, name] of IMAGE_ONLY_OPTIONS) {
    if (parsed[key] !== undefined) {
      throw new HTTPError(
        `Option '${name}' is not supported for video processing${hint}`,
        {
          code: "NOT_IMPLEMENTED",
        },
      );
    }
  }
  // brightness/contrast/saturation have non-undefined defaults, check for non-default values
  if (parsed.brightness !== 0) {
    throw new HTTPError(
      `Option 'brightness' is not supported for video processing${hint}`,
      { code: "NOT_IMPLEMENTED" },
    );
  }
  if (parsed.contrast !== 1) {
    throw new HTTPError(
      `Option 'contrast' is not supported for video processing${hint}`,
      { code: "NOT_IMPLEMENTED" },
    );
  }
  if (parsed.saturation !== 1) {
    throw new HTTPError(
      `Option 'saturation' is not supported for video processing${hint}`,
      { code: "NOT_IMPLEMENTED" },
    );
  }
}

export type VideoResult = {
  stream: Readable;
  outputFormat: string;
  codecs?: string;
};

/**
 * Predicts the output frame dimensions after applying the given resize
 * parameters to a source of the given dimensions. Returns `undefined` for
 * each axis that cannot be determined without a probe (e.g. aspect-ratio
 * preserving modes when the source size is unknown).
 */
export function predictOutputDimensions(
  resize: { type?: ResizingType; width: number; height: number } | undefined,
  sourceWidth: number | undefined,
  sourceHeight: number | undefined,
): { width: number | undefined; height: number | undefined } {
  if (!resize || (resize.width <= 0 && resize.height <= 0)) {
    return { width: sourceWidth, height: sourceHeight };
  }

  const tw = resize.width > 0 ? resize.width : 0;
  const th = resize.height > 0 ? resize.height : 0;
  const type = resize.type ?? "fit";

  switch (type) {
    case "force":
      return { width: tw || sourceWidth, height: th || sourceHeight };

    case "fill":
      // fill scales to cover the box then crops — output is exactly tw x th
      return { width: tw || sourceWidth, height: th || sourceHeight };

    case "fill-down": {
      // Like fill but never upscales — output is min(target, source) per axis after crop
      if (tw && th && sourceWidth !== undefined && sourceHeight !== undefined) {
        const scale = Math.min(
          1,
          Math.max(tw / sourceWidth, th / sourceHeight),
        );
        const sw = Math.round(sourceWidth * scale);
        const sh = Math.round(sourceHeight * scale);
        return {
          width: Math.min(tw, sw),
          height: Math.min(th, sh),
        };
      }
      return { width: undefined, height: undefined };
    }

    case "fit": {
      if (tw && th) {
        if (sourceWidth !== undefined && sourceHeight !== undefined) {
          const scale = Math.min(tw / sourceWidth, th / sourceHeight);
          return {
            width: Math.round(sourceWidth * scale),
            height: Math.round(sourceHeight * scale),
          };
        }
        // Both targets set but no source — we know output won't exceed the box
        // but the actual dimension could be smaller on one axis
        return { width: undefined, height: undefined };
      }
      // Only one target dimension: the other preserves aspect ratio
      if (tw && sourceWidth !== undefined && sourceHeight !== undefined) {
        const scale = tw / sourceWidth;
        return { width: tw, height: Math.round(sourceHeight * scale) };
      }
      if (th && sourceWidth !== undefined && sourceHeight !== undefined) {
        const scale = th / sourceHeight;
        return { width: Math.round(sourceWidth * scale), height: th };
      }
      return { width: tw || undefined, height: th || undefined };
    }

    case "auto": {
      // auto uses fill when orientations match, otherwise fit
      if (sourceWidth !== undefined && sourceHeight !== undefined && tw && th) {
        const srcLandscape = sourceWidth >= sourceHeight;
        const tgtLandscape = tw >= th;
        const useFill = srcLandscape === tgtLandscape;
        if (useFill) {
          return { width: tw, height: th };
        }
        const scale = Math.min(tw / sourceWidth, th / sourceHeight);
        return {
          width: Math.round(sourceWidth * scale),
          height: Math.round(sourceHeight * scale),
        };
      }
      return { width: undefined, height: undefined };
    }

    default:
      return { width: undefined, height: undefined };
  }
}

function isGpuFrameSizeSafe(
  width: number | undefined,
  height: number | undefined,
): boolean {
  const { width: minW, height: minH } = env.GPU_MIN_FRAME_SIZE;
  if (width !== undefined && width < minW) return false;
  if (height !== undefined && height < minH) return false;
  return true;
}

export async function processVideo(
  sourceUrl: string,
  parsed: VideoUrl,
  key: string,
): Promise<VideoResult> {
  rejectImageOnlyOptions(parsed);

  // Probing is needed to detect the source audio codec so ffmpeg can decide
  // whether to copy AAC through or re-encode to a compatible format. When the
  // output is muted we strip audio entirely, so the probe can be skipped
  // unless codec signalling is requested (which needs dimensions and fps).
  //
  // When GPU is available, we also need the source dimensions to predict the
  // output frame size — if it falls below the GPU encoder's minimum, we fall
  // back to CPU. For resize modes with fully determined output dimensions
  // (force, fill with both axes set) the probe can still be skipped.
  const gpuAvailable = await gpuReady;
  const outputDimWithoutProbe = predictOutputDimensions(
    parsed.resize,
    undefined,
    undefined,
  );
  const needsProbeDims =
    gpuAvailable &&
    (outputDimWithoutProbe.width === undefined ||
      outputDimWithoutProbe.height === undefined);
  const needsProbe = !parsed.mute || parsed.codec || needsProbeDims;

  const source = needsProbe
    ? await probeSource(sourceUrl).catch((err) => {
        logger.error("[processor] probeSource failed, using defaults", {
          sourceUrl,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      })
    : undefined;

  // Determine whether GPU is safe to use based on predicted output dimensions
  let useGpu = gpuAvailable;
  if (useGpu) {
    const predicted = predictOutputDimensions(
      parsed.resize,
      source?.width,
      source?.height,
    );
    if (!isGpuFrameSizeSafe(predicted.width, predicted.height)) {
      logger.verbose(
        "[processor] predicted output dimensions below GPU minimum, falling back to CPU",
        {
          key,
          predictedWidth: predicted.width,
          predictedHeight: predicted.height,
          gpuMinFrameSize: env.GPU_MIN_FRAME_SIZE,
        },
      );
      useGpu = false;
    }
  }

  const params = {
    resizingType: parsed.resize?.type,
    resizingAlgorithm: parsed.resizingAlgorithm,
    cropAspectRatio: parsed.cropAspectRatio,
    width: parsed.resize?.width ?? 0,
    height: parsed.resize?.height ?? 0,
    flip: parsed.flip,
    framerate: parsed.framerate,
    cut: parsed.cut,
    quality:
      parsed.formatQuality?.[parsed.outputFormat] ??
      parsed.quality ??
      env.FORMAT_QUALITY?.[parsed.outputFormat] ??
      env.QUALITY,
    maxBytes: parsed.maxBytes,
    mute: parsed.mute,
    outputFormat: parsed.outputFormat,
    gpu: useGpu,
    sourceAudioCodec: source?.audio?.codec,
    gravity: parsed.gravity,
  };

  let codecs: string | undefined;
  if (parsed.codec) {
    assert(
      source !== undefined,
      "probeSource required when codec signalling is enabled",
    );
    codecs = videoCodecString({
      outputFormat: parsed.outputFormat,
      mute: parsed.mute,
      resize: parsed.resize,
      framerate: parsed.framerate,
      source,
    });
  }

  if (parsed.outputFormat === "mp4") {
    if (useGpu) {
      using _lock = await acquireGpuLock(key);
      logger.verbose("[processor] processMp4", { key, gpu: true });
      try {
        const result = await processMp4(
          sourceUrl,
          params,
          parsed.outputFormat,
          key,
        );
        return { ...result, codecs };
      } catch (err) {
        if (!isFrameSizeError(err)) throw err;
        logger.warn(
          "[processor] GPU encode failed due to frame size, retrying with CPU",
          { key },
        );
      }
    }
    logger.verbose("[processor] processMp4", { key, gpu: false });
    const result = await processMp4(
      sourceUrl,
      { ...params, gpu: false },
      parsed.outputFormat,
      key,
    );
    return { ...result, codecs };
  }

  // WebM and fMP4 stream directly from ffmpeg — no moov atom concern, so we
  // can pipe to the response immediately for lower TTFB. For GPU requests,
  // hold a concurrency slot until the stream closes.
  if (useGpu) {
    const lock = await acquireGpuLock(key);
    const args = buildVideoArgs(sourceUrl, params);
    const stream = runFfmpeg(args, key);
    stream.on("close", () => lock[Symbol.dispose]());
    return { stream, outputFormat: parsed.outputFormat, codecs };
  }

  const args = buildVideoArgs(sourceUrl, params);
  return {
    stream: runFfmpeg(args, key),
    outputFormat: parsed.outputFormat,
    codecs,
  };
}

async function processMp4(
  sourceUrl: string,
  params: VideoParams,
  outputFormat: string,
  key: string,
) {
  // MP4 is written to a temp file so ffmpeg can place the moov atom at the
  // start (faststart). This trades higher initial latency on cache misses
  // for immediate progressive playback in browsers.
  const dir = mkdtempSync(join(tmpdir(), "asset-proxy-"));
  const outPath = join(dir, "output.mp4");
  const args = buildVideoArgs(sourceUrl, params, { outputPath: outPath });
  const ffmpeg = runFfmpeg(args, key);
  await new Promise<void>((resolve, reject) => {
    ffmpeg.on("end", resolve);
    ffmpeg.on("error", reject);
    ffmpeg.resume();
  });
  const stream = createReadStream(outPath);
  stream.on("error", () => rm(dir, { recursive: true, force: true }));
  stream.on("close", () => rm(dir, { recursive: true, force: true }));
  return { stream, outputFormat } as const;
}

/** Encode a buffer into a specific format with optional quality using sharp. */
async function encodeWithSharp(
  buffer: Buffer,
  format: ImageFormat,
  quality?: number,
): Promise<Buffer> {
  let img = sharp(buffer);
  switch (format) {
    case "jpg":
      img = img.jpeg(quality !== undefined ? { quality } : undefined);
      break;
    case "png":
      img = img.png();
      break;
    case "webp":
      img = img.webp(quality !== undefined ? { quality } : undefined);
      break;
    case "avif":
      img = img.avif(quality !== undefined ? { quality } : undefined);
      break;
    case "gif":
      img = img.gif();
      break;
  }
  return img.toBuffer();
}

/** Select the best (smallest) output format for an image buffer by comparing encoded sizes. */
async function selectBestFormat(
  buffer: Buffer,
  quality?: number,
  formatQuality?: Record<string, number>,
): Promise<{ buffer: Buffer; format: ImageFormat }> {
  const { entropy } = await sharp(buffer).stats();
  const meta = await sharp(buffer).metadata();
  const megapixels =
    meta.width && meta.height ? (meta.width * meta.height) / 1_000_000 : 0;

  if (
    env.BEST_FORMAT_MAX_RESOLUTION > 0 &&
    megapixels > env.BEST_FORMAT_MAX_RESOLUTION
  ) {
    const fmt: ImageFormat = "jpg";
    return {
      buffer: await encodeWithSharp(
        buffer,
        fmt,
        formatQuality?.["jpg"] ?? quality,
      ),
      format: fmt,
    };
  }

  const isSimple = entropy < env.BEST_FORMAT_COMPLEXITY_THRESHOLD;

  const candidates: ImageFormat[] = isSimple
    ? ["png", "webp"]
    : ["jpg", "webp", "avif"];

  const results = await Promise.all(
    candidates.map(async (fmt) => {
      const q = formatQuality?.[fmt] ?? quality;
      // For lossless encoding of simple images, omit quality for PNG and use lossless for WebP
      let encoded: Buffer;
      if (isSimple && fmt === "webp") {
        encoded = await sharp(buffer).webp({ lossless: true }).toBuffer();
      } else {
        encoded = await encodeWithSharp(buffer, fmt, q);
      }
      return { format: fmt, buffer: encoded, size: encoded.length };
    }),
  );

  results.sort((a, b) => a.size - b.size);
  return { buffer: results[0].buffer, format: results[0].format };
}

export interface ProcessImageResult {
  buffer: Buffer;
  outputFormat: ImageFormat;
}

export async function processImage(
  sourceUrl: string,
  parsed: ImageUrl,
): Promise<ProcessImageResult> {
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

  // Determine if best format selection is active
  const useBestFormat =
    parsed.bestFormat || (!parsed.bestFormat && env.BEST_FORMAT_BY_DEFAULT);

  // Resolve effective quality: per-request format > per-request global > env format > env global
  const effectiveQuality =
    parsed.formatQuality?.[parsed.outputFormat] ??
    parsed.quality ??
    env.FORMAT_QUALITY?.[parsed.outputFormat] ??
    env.QUALITY;
  const effectiveParsed = { ...parsed, quality: effectiveQuality };

  // When best format is active, use PNG as intermediate format for ffmpeg
  const ffmpegParsed = useBestFormat
    ? ({
        ...effectiveParsed,
        outputFormat: "png" as ImageFormat,
        quality: undefined,
      } as ImageUrl)
    : effectiveParsed;

  let buffer: Buffer;
  let outputFormat: ImageFormat = parsed.outputFormat;

  // Video thumbnail animation: generate animated gif/webp from video frames
  if (parsed.videoThumbnailAnimation) {
    buffer = await generateVideoAnimation(ffmpegInput, effectiveParsed);
    outputFormat = parsed.outputFormat === "gif" ? "gif" : "webp";
  } else if (!useBestFormat && parsed.outputFormat === "avif") {
    const dir = mkdtempSync(join(tmpdir(), "asset-proxy-"));
    const outPath = join(dir, "output.avif");
    const args = buildImageArgs(ffmpegInput, ffmpegParsed, {
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
      buildImageArgs(ffmpegInput, ffmpegParsed, { trimFilter }),
    );
    buffer = await new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  }

  // Best format: compare candidate formats and pick the smallest
  if (useBestFormat && !parsed.videoThumbnailAnimation) {
    const best = await selectBestFormat(
      buffer,
      parsed.quality ?? env.QUALITY,
      parsed.formatQuality ?? (parsed.quality ? undefined : env.FORMAT_QUALITY),
    );
    buffer = best.buffer;
    outputFormat = best.format;
  }

  const aq =
    parsed.autoquality ??
    (env.AUTOQUALITY_METHOD !== "none"
      ? {
          method: env.AUTOQUALITY_METHOD as "dssim",
          target: env.AUTOQUALITY_TARGET ?? 0.02,
          min:
            env.AUTOQUALITY_FORMAT_MIN?.[outputFormat] ??
            env.AUTOQUALITY_MIN ??
            70,
          max:
            env.AUTOQUALITY_FORMAT_MAX?.[outputFormat] ??
            env.AUTOQUALITY_MAX ??
            80,
          allowedError: env.AUTOQUALITY_ALLOWED_ERROR ?? 0.001,
        }
      : undefined);

  if (aq?.method === "dssim") {
    buffer = await autoqualityDssim(buffer, outputFormat, {
      target: aq.target,
      min: aq.min,
      max: aq.max,
      allowedError: aq.allowedError,
    });
  } else if (aq?.method === "size" && aq.target) {
    buffer = await shrinkToMaxBytes(buffer, outputFormat, aq.target);
  }

  if (
    parsed.jpegOptions ||
    parsed.pngOptions ||
    parsed.webpOptions ||
    parsed.avifOptions
  ) {
    buffer = await applyFormatOptions(buffer, parsed);
  }

  if (
    parsed.maxBytes &&
    parsed.maxBytes > 0 &&
    buffer.length > parsed.maxBytes
  ) {
    buffer = await shrinkToMaxBytes(buffer, outputFormat, parsed.maxBytes);
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

  return { buffer, outputFormat };
}

/** Extract embedded thumbnail from an image. Tries exiftool (EXIF/AVIF) then heif-thumbnailer (HEIC). */
async function extractThumbnail(
  sourcePath: string,
): Promise<string | undefined> {
  const span = tracer.startSpan("extractThumbnail");
  try {
    const dir = mkdtempSync(join(tmpdir(), "asset-proxy-thumb-"));

    // Try exiftool first (works for AVIF/JPEG EXIF thumbnails)
    const exifThumb = join(dir, "thumbnail.jpg");
    try {
      const exiftoolExtractArgs = ["-b", "-ThumbnailImage", sourcePath];
      logger.verbose("Running exiftool", {
        args: exiftoolExtractArgs.join(" "),
      });
      const exifSpan = tracer.startSpan("exec.exiftool.thumbnail");
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("exiftool", exiftoolExtractArgs);
        const chunks: Buffer[] = [];
        proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
        proc.on("close", async (code) => {
          exifSpan.setAttribute("process.exit_code", code ?? -1);
          if (code !== 0 || chunks.length === 0) {
            const err = new Error("No EXIF thumbnail");
            recordException(exifSpan, err);
            exifSpan.end();
            reject(err);
            return;
          }
          await writeFile(exifThumb, Buffer.concat(chunks));
          exifSpan.end();
          resolve();
        });
        proc.on("error", (err) => {
          recordException(exifSpan, err);
          exifSpan.end();
          reject(err);
        });
      });
      span.setAttribute("thumbnail.source", "exiftool");
      return exifThumb;
    } catch {
      // Fall through to heif-thumbnailer
    }

    // Try heif-thumbnailer (works for HEIC container thumbnails)
    const heifThumb = join(dir, "thumbnail.png");
    try {
      const heifArgs = [sourcePath, heifThumb];
      logger.verbose("Running heif-thumbnailer", { args: heifArgs.join(" ") });
      const heifSpan = tracer.startSpan("exec.heif-thumbnailer");
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("heif-thumbnailer", heifArgs);
        proc.on("close", async (code) => {
          heifSpan.setAttribute("process.exit_code", code ?? -1);
          if (code !== 0) {
            const err = new Error("No HEIC thumbnail");
            recordException(heifSpan, err);
            heifSpan.end();
            reject(err);
            return;
          }
          heifSpan.end();
          resolve();
        });
        proc.on("error", (err) => {
          recordException(heifSpan, err);
          heifSpan.end();
          reject(err);
        });
      });
      // Verify the file was created and is non-empty
      const stat = await readFile(heifThumb);
      if (stat.length > 0) {
        span.setAttribute("thumbnail.source", "heif-thumbnailer");
        return heifThumb;
      }
    } catch {
      // No thumbnail found
    }

    await rm(dir, { recursive: true, force: true });
    return undefined;
  } finally {
    span.end();
  }
}

/** Binary search on quality targeting a DSSIM value using sharp + ffmpeg SSIM filter. */
async function autoqualityDssim(
  original: Buffer,
  format: ImageFormat,
  opts: { target: number; min: number; max: number; allowedError: number },
): Promise<Buffer> {
  let lo = opts.min;
  let hi = opts.max;
  let best = original;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const encoded = await reencodeWithQuality(original, format, mid);
    const dssim = await computeDssim(original, encoded);

    if (Math.abs(dssim - opts.target) <= opts.allowedError) {
      return encoded;
    }

    if (dssim < opts.target) {
      // Quality too high (too similar) — lower it
      best = encoded;
      hi = mid - 1;
    } else {
      // Quality too low (too different) — raise it
      lo = mid + 1;
    }
  }

  return best;
}

async function reencodeWithQuality(
  buffer: Buffer,
  format: ImageFormat,
  quality: number,
): Promise<Buffer> {
  let img = sharp(buffer);
  switch (format) {
    case "jpg":
      img = img.jpeg({ quality });
      break;
    case "webp":
      img = img.webp({ quality });
      break;
    case "avif":
      img = img.avif({ quality });
      break;
    default:
      return buffer;
  }
  return img.toBuffer();
}

/** Compute DSSIM between two image buffers using ffmpeg's SSIM filter. DSSIM = (1 - SSIM) / 2. */
async function computeDssim(a: Buffer, b: Buffer): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), "asset-proxy-ssim-"));
  const pathA = join(dir, "a.png");
  const pathB = join(dir, "b.png");

  // Convert both to PNG for consistent comparison
  await writeFile(pathA, await sharp(a).png().toBuffer());
  await writeFile(pathB, await sharp(b).png().toBuffer());

  return new Promise<number>((resolve) => {
    const ssimArgs = [
      "-hide_banner",
      "-i",
      pathA,
      "-i",
      pathB,
      "-lavfi",
      "ssim",
      "-f",
      "null",
      "-",
    ];
    logger.verbose("Running ffmpeg", { args: ssimArgs.join(" ") });
    const proc = spawn("ffmpeg", ssimArgs);

    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", async () => {
      await rm(dir, { recursive: true, force: true });
      // Parse SSIM from stderr: "SSIM All:0.987654 (19.123456)"
      const match = stderr.match(/All:([\d.]+)/);
      const ssim = match ? parseFloat(match[1]) : 1;
      resolve((1 - ssim) / 2);
    });
  });
}

/** Generate an animated gif/webp from video frames using ffmpeg. */
async function generateVideoAnimation(
  sourceUrl: string,
  parsed: ImageUrl,
): Promise<Buffer> {
  const vta = parsed.videoThumbnailAnimation!;
  const fps = vta.step > 0 ? 1 / vta.step : 10;
  const args = ["-hide_banner", "-y", "-i", sourceUrl];
  const filters: string[] = [];

  filters.push(`fps=${fps}`);

  let targetW = vta.frameWidth > 0 ? vta.frameWidth : 0;
  let targetH = vta.frameHeight > 0 ? vta.frameHeight : 0;
  if (!targetW && !targetH && parsed.resize) {
    targetW = parsed.resize.width > 0 ? parsed.resize.width : 0;
    targetH = parsed.resize.height > 0 ? parsed.resize.height : 0;
  }

  if (targetW > 0 || targetH > 0) {
    const w = targetW > 0 ? targetW : -1;
    const h = targetH > 0 ? targetH : -1;

    if (vta.fill && targetW > 0 && targetH > 0) {
      filters.push(`scale=${w}:${h}:force_original_aspect_ratio=increase`);
      const cropX = `(iw-${targetW})*${vta.focusX}`;
      const cropY = `(ih-${targetH})*${vta.focusY}`;
      filters.push(`crop=${targetW}:${targetH}:${cropX}:${cropY}`);
    } else {
      filters.push(`scale=${w}:${h}:force_original_aspect_ratio=decrease`);
      if (vta.extendFrame && targetW > 0 && targetH > 0) {
        filters.push(
          `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:color=black`,
        );
      }
    }
  }

  if (vta.frames > 0) {
    args.push("-frames:v", String(vta.frames));
  }

  if (filters.length > 0) {
    args.push("-vf", filters.join(","));
  }

  if (parsed.outputFormat === "gif") {
    args.push("-f", "gif", "pipe:1");
  } else {
    // Default to animated webp
    args.push("-loop", "0");
    const webpQuality =
      parsed.formatQuality?.["webp"] ??
      parsed.quality ??
      env.FORMAT_QUALITY?.["webp"] ??
      env.QUALITY;
    args.push("-quality", String(webpQuality));
    args.push("-f", "webp", "pipe:1");
  }

  const stream = runFfmpeg(args);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function applyFormatOptions(
  buffer: Buffer,
  parsed: ImageUrl,
): Promise<Buffer> {
  let img = sharp(buffer);
  switch (parsed.outputFormat) {
    case "jpg": {
      const opts = parsed.jpegOptions;
      img = img.jpeg({
        quality: parsed.quality,
        progressive: opts?.progressive,
        chromaSubsampling: opts?.noSubsample ? "4:4:4" : undefined,
        trellisQuantisation: opts?.trellisQuant,
        overshootDeringing: opts?.overshootDeringing,
        optimiseScans: opts?.optimizeScans,
        quantisationTable: opts?.quantTable,
      });
      break;
    }
    case "png": {
      const opts = parsed.pngOptions;
      img = img.png({
        progressive: opts?.interlaced,
        palette: opts?.quantize,
        colours: opts?.quantizationColours,
      });
      break;
    }
    case "webp": {
      const opts = parsed.webpOptions;
      img = img.webp({
        quality: parsed.quality,
        effort: opts?.compression,
        smartSubsample: opts?.smartSubsample,
        preset: opts?.preset as never,
      });
      break;
    }
    case "avif": {
      const opts = parsed.avifOptions;
      img = img.avif({
        quality: parsed.quality,
        chromaSubsampling: opts?.subsample,
      });
      break;
    }
    default:
      return buffer;
  }
  return img.toBuffer();
}

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
  const span = tracer.startSpan("exec.exiftool", {
    attributes: {
      "exiftool.has_source": !!opts.sourcePath,
      "exiftool.copyright_only": !!opts.copyrightOnly,
    },
  });
  try {
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
    logger.verbose("Running exiftool", { args: exiftoolArgs.join(" ") });

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
  } catch (err) {
    recordException(span, err);
    throw err;
  } finally {
    span.end();
  }
}

function runFfmpeg(args: string[], key?: string): Readable {
  logger.verbose("[processor] runFfmpeg", { key, args: args.join(" ") });
  const span = tracer.startSpan("exec.ffmpeg");
  const proc = spawn("ffmpeg", args);
  const output = new PassThrough();

  // Pipe stdout but don't let it end the PassThrough — we control
  // that from the close handler so we can emit errors on failure.
  proc.stdout.pipe(output, { end: false });

  let stderr = "";
  proc.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderr += text;
    if (stderr.length > 10000) stderr = stderr.slice(-5000);
    logger.debug("[processor] ffmpeg stderr", { key, text });
  });

  proc.on("close", (code) => {
    logger.verbose("[processor] ffmpeg closed", { key, code });
    span.setAttribute("process.exit_code", code ?? -1);
    if (code !== 0) {
      const err = Object.assign(new Error(`ffmpeg exited with code ${code}`), {
        stderr: stderr.slice(-2000),
      });
      recordException(span, err);
      logger.error("[processor] ffmpeg exited with non-zero code", {
        key,
        code,
        stderr: err.stderr,
      });
      output.destroy(err);
    } else {
      output.end();
    }
    span.end();
  });

  output.on("error", () => {
    proc.kill("SIGTERM");
  });

  return output;
}

const FRAME_SIZE_PATTERN =
  /Frame Dimension less than the minimum supported value/i;

function isFrameSizeError(err: unknown): boolean {
  if (err && typeof err === "object" && "stderr" in err) {
    return FRAME_SIZE_PATTERN.test(String((err as { stderr: unknown }).stderr));
  }
  return false;
}

const SOURCE_NOT_FOUND_PATTERN = /Server returned 4(?:04|10)/;

/** Checks whether an ffmpeg error indicates that the source URL returned HTTP 404 or 410. */
export function isSourceNotFoundError(err: unknown): boolean {
  if (err && typeof err === "object" && "stderr" in err) {
    return SOURCE_NOT_FOUND_PATTERN.test(
      String((err as { stderr: unknown }).stderr),
    );
  }
  return false;
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
  const span = tracer.startSpan("exec.ffmpeg.cropdetect");
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
    logger.verbose("Running ffmpeg", { args: args.join(" ") });

    const proc = spawn("ffmpeg", args);
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      span.setAttribute("process.exit_code", code ?? -1);
      // Parse last cropdetect line: "crop=W:H:X:Y"
      const match = stderr.match(/crop=(\d+:\d+:\d+:\d+)/g);
      if (!match) {
        span.end();
        resolve(undefined);
        return;
      }
      const last = match[match.length - 1];
      const [w, h, x, y] = last.replace("crop=", "").split(":").map(Number);

      if (trim.equalHor || trim.equalVert) {
        const cropFilter = `crop=${w}:${h}`;
        span.end();
        resolve(cropFilter);
      } else {
        span.end();
        resolve(`crop=${w}:${h}:${x}:${y}`);
      }
    });

    proc.on("error", () => {
      span.end();
      resolve(undefined);
    });
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
  quality?: number;
  maxBytes?: number;
  mute?: boolean;
  outputFormat: OutputFormat;
  gpu: boolean;
  sourceAudioCodec?: string;
  gravity?: Gravity;
}

/** @internal Exported for testing only. */
export function buildVideoArgs(
  sourceUrl: string,
  params: VideoParams,
  opts?: { outputPath?: string },
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
    quality,
    maxBytes,
    outputFormat,
    gravity,
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
    if (resizingAlgorithm?.mode === "cpu") {
      throw new HTTPError(
        "CPU resizing algorithms are not supported with GPU acceleration — use gpu:scale_cuda, gpu:scale_npp, or gpu:cuvid, or disable GPU",
        { code: "BAD_REQUEST" },
      );
    }

    const scaler: ResizingAlgorithm =
      resizingAlgorithm?.mode === "gpu"
        ? resizingAlgorithm
        : { mode: "gpu", scaler: "scale_cuda" };
    const isCuvid = scaler.mode === "gpu" && scaler.scaler === "cuvid";

    if (isCuvid) {
      args.push("-hwaccel", "cuvid", "-hwaccel_output_format", "cuda");
      if (hasResize) {
        const effectiveType = resizingType ?? "fit";
        if (effectiveType !== "force") {
          throw new HTTPError(
            `cuvid scaler only supports 'force' resize type (got '${effectiveType}') — use scale_cuda or scale_npp for aspect-ratio-aware resizing`,
            { code: "BAD_REQUEST" },
          );
        }
        args.push("-resize", `${width}x${height}`);
      }
      args.push("-i", sourceUrl);
      const extra = [...preFilters, ...postFilters];
      if (extra.length > 0) {
        args.push("-vf", extra.join(","));
      }
    } else {
      args.push("-hwaccel", "cuda", "-hwaccel_output_format", "cuda");
      if (hasResize) {
        args.push("-i", sourceUrl);
        const scaleFilter = buildScaleFilter({
          resizingType: resizingType ?? "fit",
          resizingAlgorithm: scaler,
          width,
          height,
          gpu: true,
          gravity,
        });
        const vf = [...preFilters, scaleFilter, ...postFilters].join(",");
        args.push("-vf", vf);
      } else {
        args.push("-i", sourceUrl);
        const extra = [...preFilters, ...postFilters];
        if (extra.length > 0) {
          args.push("-vf", extra.join(","));
        }
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
          gravity,
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
    // AV1 encoders require even dimensions for YUV 4:2:0. When aspect-ratio
    // preserving scale modes produce odd widths/heights, trim to even.
    const vfIdx = args.lastIndexOf("-vf");
    if (vfIdx !== -1) {
      args[vfIdx + 1] += ",crop=trunc(iw/2)*2:trunc(ih/2)*2";
    } else {
      args.push("-vf", "crop=trunc(iw/2)*2:trunc(ih/2)*2");
    }

    if (gpu) {
      args.push("-c:v", "av1_nvenc", "-preset", "p4", "-tune", "hq");
      if (quality !== undefined) {
        // NVENC CQ: 0-51 (0=best), map 1-100 → 51-0
        args.push("-cq", String(Math.round(51 - (quality / 100) * 51)));
      }
    } else {
      args.push("-c:v", "libsvtav1", "-preset", "8");
      if (quality !== undefined) {
        // SVT-AV1 CRF: 0-63 (0=best), map 1-100 → 63-0
        args.push("-crf", String(Math.round(63 - (quality / 100) * 63)));
      }
    }
    if (params.mute || !params.sourceAudioCodec) {
      args.push("-an");
    } else if (params.sourceAudioCodec === "opus") {
      args.push("-c:a", "copy");
    } else {
      args.push("-c:a", "libopus");
    }
    if (maxBytes) args.push("-fs", String(maxBytes));
    args.push("-f", "webm", opts?.outputPath ?? "pipe:1");
  } else {
    if (gpu) {
      args.push("-c:v", "h264_nvenc", "-preset", "p4", "-tune", "hq");
      if (quality !== undefined) {
        // NVENC CQ: 0-51 (0=best), map 1-100 → 51-0
        args.push("-cq", String(Math.round(51 - (quality / 100) * 51)));
      }
    } else {
      args.push("-c:v", "libx264", "-preset", "fast");
      if (quality !== undefined) {
        // libx264 CRF: 0-51 (0=best), map 1-100 → 51-0
        args.push("-crf", String(Math.round(51 - (quality / 100) * 51)));
      }
    }
    if (params.mute || !params.sourceAudioCodec) {
      args.push("-an");
    } else if (params.sourceAudioCodec === "aac") {
      args.push("-c:a", "copy");
    } else {
      args.push("-c:a", "aac");
    }
    if (outputFormat === "fmp4") {
      args.push("-movflags", "+frag_keyframe+empty_moov+default_base_moof");
    } else {
      args.push("-movflags", "+faststart");
    }
    if (maxBytes) args.push("-fs", String(maxBytes));
    args.push("-f", "mp4", opts?.outputPath ?? "pipe:1");
  }

  return args;
}

function buildImageArgs(
  sourceUrl: string,
  parsed: ImageUrl,
  opts?: { outputPath?: string; trimFilter?: string },
): string[] {
  const args = ["-hide_banner", "-y"];

  // Video thumbnail: seek to given second before input for faster seeking
  if (parsed.videoThumbnailSecond !== undefined) {
    args.push("-ss", String(parsed.videoThumbnailSecond));
  }

  // Video thumbnail: use only keyframes
  if (parsed.videoThumbnailKeyframes) {
    args.push("-skip_frame", "nokey");
  }

  args.push("-i", sourceUrl);

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
        enlarge: parsed.enlarge ?? false,
        gravity: parsed.gravity,
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

  // Flatten transparency onto background colour using alpha blending via geq.
  // geq blends each pixel: out = fg * alpha + bg * (1 - alpha), then sets alpha to 255.
  if (parsed.background && (parsed.backgroundAlpha ?? 1) >= 1) {
    const { r, g, b } = parsed.background;
    filters.push(
      "format=rgba",
      `geq=r='r(X,Y)*alpha(X,Y)/255+${r}*(255-alpha(X,Y))/255':g='g(X,Y)*alpha(X,Y)/255+${g}*(255-alpha(X,Y))/255':b='b(X,Y)*alpha(X,Y)/255+${b}*(255-alpha(X,Y))/255':a='255'`,
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
        ? rgbToHex(parsed.background, parsed.backgroundAlpha)
        : "black@0";
      filters.push(`pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:${colour}`);
    }
  }

  // Extend aspect ratio — pad image to match the target aspect ratio
  if (parsed.extendAspectRatio?.enabled && parsed.resize) {
    const tw = parsed.resize.width || 0;
    const th = parsed.resize.height || 0;
    if (tw > 0 && th > 0) {
      const targetRatio = tw / th;
      const colour = parsed.background
        ? rgbToHex(parsed.background, parsed.backgroundAlpha)
        : "black@0";
      const g = parsed.extendAspectRatio.gravity;
      // Widen: pad width to match target aspect ratio (image is too tall)
      // Heighten: pad height to match target aspect ratio (image is too wide)
      const padW = `max(iw\\,ceil(ih*${targetRatio}/2)*2)`;
      const padH = `max(ih\\,ceil(iw/${targetRatio}/2)*2)`;
      const { x, y } = gravityToPadPosition(g);
      filters.push(`pad=${padW}:${padH}:${x}:${y}:${colour}`);
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

/** Return ffmpeg pad x:y offset expressions for the given compass gravity.
 * In a pad filter x/y position the input image within the larger output. */
function gravityToPadPosition(g: CompassGravity): { x: string; y: string } {
  const cx = "(ow-iw)/2";
  const cy = "(oh-ih)/2";
  switch (g) {
    case "ce":
      return { x: cx, y: cy };
    case "no":
      return { x: cx, y: "0" };
    case "so":
      return { x: cx, y: "oh-ih" };
    case "ea":
      return { x: "ow-iw", y: cy };
    case "we":
      return { x: "0", y: cy };
    case "noea":
      return { x: "ow-iw", y: "0" };
    case "nowe":
      return { x: "0", y: "0" };
    case "soea":
      return { x: "ow-iw", y: "oh-ih" };
    case "sowe":
      return { x: "0", y: "oh-ih" };
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
  enlarge?: boolean;
  gravity?: Gravity;
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
  enlarge,
  gravity,
}: ScaleFilterParams): string {
  const w = width > 0 ? width : -1;
  const h = height > 0 ? height : -1;

  // Determine scale filter name and algorithm suffix
  let scaleName: string;
  let flagsSuffix = "";

  if (gpu) {
    // GPU always requires an explicit scaler (scale_cuda or scale_npp)
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

  // When enlarge is false, clamp target dimensions so the image is never
  // scaled beyond its original size.
  const noEnlarge = enlarge === false;
  const clampW = noEnlarge && width > 0 ? `'min(${width}\\,iw)'` : String(w);
  const clampH = noEnlarge && height > 0 ? `'min(${height}\\,ih)'` : String(h);

  switch (resizingType) {
    case "fit":
      if (gpu) {
        return `${scaleName}=w='min(${width || 99999},iw*min(${width || 99999}/iw\\,${height || 99999}/ih))':h='min(${height || 99999},ih*min(${width || 99999}/iw\\,${height || 99999}/ih))'${flagsSuffix}`;
      }
      return `${scaleName}=${clampW}:${clampH}:force_original_aspect_ratio=decrease${flagsSuffix}`;

    case "fill": {
      const { x: fx, y: fy } = gravityOffsets(gravity, width, height);
      if (gpu) {
        return `${scaleName}=w='max(${width},iw*max(${width}/iw\\,${height}/ih))':h='max(${height},ih*max(${width}/iw\\,${height}/ih))'${flagsSuffix},hwdownload,format=nv12,crop=${width}:${height}:${fx}:${fy},hwupload_cuda`;
      }
      if (noEnlarge) {
        return `${scaleName}=${clampW}:${clampH}:force_original_aspect_ratio=increase${flagsSuffix},crop='min(${width}\\,iw)':'min(${height}\\,ih)':${fx}:${fy}`;
      }
      return `${scaleName}=${w}:${h}:force_original_aspect_ratio=increase${flagsSuffix},crop=${width}:${height}:${fx}:${fy}`;
    }

    case "fill-down": {
      const { x: fdx, y: fdy } = gravityOffsets(gravity, width, height);
      if (gpu) {
        return `${scaleName}=w='min(iw,max(${width},iw*max(${width}/iw\\,${height}/ih)))':h='min(ih,max(${height},ih*max(${width}/iw\\,${height}/ih)))'${flagsSuffix},hwdownload,format=nv12,crop='min(${width},iw)':'min(${height},ih)':${fdx}:${fdy},hwupload_cuda`;
      }
      return `${scaleName}=${w}:${h}:force_original_aspect_ratio=increase${flagsSuffix},crop='min(${width},iw)':'min(${height},ih)':${fdx}:${fdy}`;
    }

    case "force":
      if (noEnlarge) {
        return `${scaleName}=${clampW}:${clampH}${flagsSuffix}`;
      }
      return `${scaleName}=${width}:${height}${flagsSuffix}`;

    case "auto":
      if (gpu) {
        return `hwdownload,format=nv12,scale=${w}:${h}:force_original_aspect_ratio='if(gt(dar,${width}/${height}),1,2)'${flagsSuffix}`;
      }
      return `scale=${clampW}:${clampH}:force_original_aspect_ratio='if(gt(dar,${width}/${height}),1,2)'${flagsSuffix}`;

    default:
      return `${scaleName}=${clampW}:${clampH}${flagsSuffix}`;
  }
}
