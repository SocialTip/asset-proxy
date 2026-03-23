import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import express from "express";
import { encode as blurhashEncode } from "blurhash";
import sharp from "sharp";
import {
  HTTPError,
  parseInfoUrl,
  verifySignature,
  type InfoOptions,
} from "@socialtip/asset-proxy-url-parser";
import { env } from "./env.js";
import { logger } from "./logger.js";

const execFileAsync = promisify(execFile);

// Max bytes to stream to exiftool for metadata extraction. EXIF data is
// limited to 64KB and the APP1 marker appears within the first ~100 bytes,
// so 100KB is more than sufficient. Combined with exiftool's -fast flag,
// this avoids downloading the full file.
const METADATA_STREAM_LIMIT = 102400;

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  mjpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  bmp: "image/bmp",
  tiff: "image/tiff",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  flv: "video/x-flv",
};

interface InfoResponse {
  format: string;
  mime_type: string;
  width: number;
  height: number;
  orientation: number;
  colorspace?: string;
  bands?: number;
  sample_format?: string;
  pages_number?: number;
  alpha?: { alpha: boolean; transparent?: boolean };
  size?: number;
  duration?: number;
  video_meta?: {
    codec: string;
    bitrate?: number;
    framerate?: number;
  };
  exif?: Record<string, unknown>;
  iptc?: Record<string, unknown>;
  xmp?: Record<string, unknown>;
  palette?: Array<{ R: number; G: number; B: number; A: number }>;
  average?: { R: number; G: number; B: number };
  dominant_colors?: Record<string, { R: number; G: number; B: number }>;
  blurhash?: string;
  hashsums?: Record<string, string>;
}

function isVideoFormat(formatName: string): boolean {
  const videoFormats = new Set([
    "mp4",
    "mov",
    "avi",
    "mkv",
    "webm",
    "flv",
    "matroska",
    "mov,mp4,m4a,3gp,3g2,mj2",
    "avi",
  ]);
  return videoFormats.has(formatName);
}

interface LazyBuffer {
  (): Promise<Buffer>;
  pending(): Promise<Buffer> | undefined;
}

function createLazyBuffer(sourceUrl: string): LazyBuffer {
  let promise: Promise<Buffer> | undefined;
  const fn = (() => {
    promise ??= fetchSource(sourceUrl);
    return promise;
  }) as LazyBuffer;
  fn.pending = () => promise;
  return fn;
}

function pixFmtHasAlpha(pixFmt: string): boolean {
  return /rgba|argb|bgra|abgr|yuva|gbra|ya[0-9]|pal8/i.test(pixFmt);
}

function bandsFromPixFmt(pixFmt: string): number {
  if (pixFmtHasAlpha(pixFmt)) {
    if (/^(ya|gray.*a)/i.test(pixFmt)) return 2;
    return 4;
  }
  if (/^(gray|y[0-9])/i.test(pixFmt)) return 1;
  return 3;
}

function sampleFormatFromPixFmt(
  pixFmt: string,
  bitsPerRawSample?: string,
): string {
  const bits = parseInt(bitsPerRawSample ?? "", 10);
  if (bits > 0) {
    if (bits <= 8) return "uchar";
    if (bits <= 16) return "ushort";
    return "float";
  }
  if (/16|48|64/i.test(pixFmt)) return "ushort";
  if (/f32|float/i.test(pixFmt)) return "float";
  return "uchar";
}

type RGB = { R: number; G: number; B: number };

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

async function extractDominantColors(
  buf: Buffer,
  opts: Record<string, unknown> = {},
): Promise<Record<string, RGB>> {
  const quantised = await sharp(buf, opts)
    .removeAlpha()
    .png({ palette: true, colours: 64, effort: 1 })
    .toBuffer();
  const { data, info } = await sharp(quantised)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const freq = new Map<
    string,
    { r: number; g: number; b: number; s: number; l: number; count: number }
  >();
  for (let i = 0; i < data.length; i += info.channels) {
    const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    const existing = freq.get(key);
    if (existing) {
      existing.count++;
    } else {
      const [, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      freq.set(key, {
        r: data[i],
        g: data[i + 1],
        b: data[i + 2],
        s,
        l,
        count: 1,
      });
    }
  }

  const colours = [...freq.values()];

  const pick = (
    filter: (c: (typeof colours)[0]) => boolean,
  ): RGB | undefined => {
    const match = colours.filter(filter).sort((a, b) => b.count - a.count)[0];
    return match ? { R: match.r, G: match.g, B: match.b } : undefined;
  };

  const result: Record<string, RGB> = {};
  const vibrant = pick((c) => c.s > 0.35 && c.l > 0.3 && c.l < 0.7);
  if (vibrant) result.vibrant = vibrant;
  const lightVibrant = pick((c) => c.s > 0.35 && c.l >= 0.7);
  if (lightVibrant) result.light_vibrant = lightVibrant;
  const darkVibrant = pick((c) => c.s > 0.35 && c.l <= 0.3);
  if (darkVibrant) result.dark_vibrant = darkVibrant;
  const muted = pick((c) => c.s <= 0.35 && c.l > 0.3 && c.l < 0.7);
  if (muted) result.muted = muted;
  const lightMuted = pick((c) => c.s <= 0.35 && c.l >= 0.7);
  if (lightMuted) result.light_muted = lightMuted;
  const darkMuted = pick((c) => c.s <= 0.35 && c.l <= 0.3);
  if (darkMuted) result.dark_muted = darkMuted;
  return result;
}

async function extractPalette(
  buf: Buffer,
  colours: number,
  opts: Record<string, unknown> = {},
): Promise<Array<{ R: number; G: number; B: number; A: number }>> {
  const quantised = await sharp(buf, opts)
    .removeAlpha()
    .png({ palette: true, colours, effort: 1 })
    .toBuffer();
  const { data, info } = await sharp(quantised)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const seen = new Set<string>();
  const result: Array<{ R: number; G: number; B: number; A: number }> = [];
  for (let i = 0; i < data.length; i += info.channels) {
    const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ R: data[i], G: data[i + 1], B: data[i + 2], A: 255 });
    }
  }
  return result;
}

async function fetchSource(sourceUrl: string): Promise<Buffer> {
  const res = await fetch(sourceUrl);
  if (!res.ok) {
    throw new HTTPError("Could not fetch source", {
      code: "UNPROCESSABLE_ENTITY",
    });
  }
  return Buffer.from(await res.arrayBuffer());
}

async function runExiftool(
  source: Buffer | Promise<Buffer> | string,
  groups: string[],
): Promise<Record<string, unknown>> {
  const args = ["-fast", "-json", "-n", "-G1", ...groups, "-"];
  const proc = execFile("exiftool", args);

  // Collect stdout and wait for close. Must be registered before writing to
  // stdin — if exiftool exits quickly the close event would be missed.
  const stdout = new Promise<string>((resolve, reject) => {
    let out = "";
    proc.stdout!.on("data", (chunk: string | Buffer) => {
      out += typeof chunk === "string" ? chunk : chunk.toString();
    });
    proc.on("close", () => resolve(out));
    proc.on("error", reject);
  });

  // Exiftool may exit after reading the metadata header but before we finish
  // writing. Swallow the resulting EPIPE on stdin for all branches.
  proc.stdin!.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code !== "EPIPE") throw err;
  });

  if (Buffer.isBuffer(source)) {
    proc.stdin!.end(source.subarray(0, METADATA_STREAM_LIMIT));
  } else if (typeof source !== "string") {
    const buf = await source;
    proc.stdin!.end(buf.subarray(0, METADATA_STREAM_LIMIT));
  } else {
    const controller = new AbortController();
    const res = await fetch(source, { signal: controller.signal });
    if (!res.ok || !res.body) {
      proc.stdin!.end();
      throw new HTTPError("Could not fetch source", {
        code: "UNPROCESSABLE_ENTITY",
      });
    }
    // When the HTTP response is slower than exiftool (e.g. large remote files
    // with small EXIF headers), exiftool can finish and exit while we are still
    // streaming. Track exit state to stop writing.
    let exited = false;
    proc.on("exit", () => {
      exited = true;
    });
    let written = 0;
    for await (const chunk of res.body) {
      if (exited) break;
      const buf = Buffer.from(chunk);
      const remaining = METADATA_STREAM_LIMIT - written;
      if (remaining <= 0) break;
      proc.stdin!.write(buf.subarray(0, remaining));
      written += buf.length;
      if (written >= METADATA_STREAM_LIMIT) break;
    }
    controller.abort();
    if (!exited) proc.stdin!.end();
  }

  const parsed = JSON.parse(await stdout);
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

function groupExiftoolOutput(
  raw: Record<string, unknown>,
  prefix: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const pfx = prefix + ":";
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith(pfx)) {
      result[key.slice(pfx.length)] = value;
    }
  }
  return result;
}

function groupExiftoolXmp(
  raw: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith("XMP-")) continue;
    const rest = key.slice(4);
    const colonIdx = rest.indexOf(":");
    if (colonIdx === -1) continue;
    const ns = rest.slice(0, colonIdx);
    const field = rest.slice(colonIdx + 1);
    if (!result[ns]) result[ns] = {};
    result[ns][field] = value;
  }
  return result;
}

async function probeMetadata(
  sourceUrl: string,
  infoOpts: InfoOptions,
  getBuffer: LazyBuffer,
): Promise<InfoResponse> {
  // ffprobe reads directly from URL — no download needed
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    sourceUrl,
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const probe: any = JSON.parse(stdout);
  const stream = probe.streams?.find(
    (s: Record<string, unknown>) => s.codec_type === "video",
  );

  if (!stream) {
    throw new HTTPError("Could not read media metadata", {
      code: "UNPROCESSABLE_ENTITY",
    });
  }

  const formatName: string = probe.format?.format_name ?? stream.codec_name;
  const isVideo = isVideoFormat(formatName);

  const format = isVideo ? formatName.split(",")[0] : stream.codec_name;
  const mimeType =
    MIME_TYPES[format] ?? (isVideo ? "video/mp4" : `image/${format}`);

  const pixFmt: string = stream.pix_fmt ?? "";
  const sharpOpts = infoOpts.page !== undefined ? { page: infoOpts.page } : {};

  const result: InfoResponse = {
    format,
    mime_type: mimeType,
    width: stream.width,
    height: stream.height,
    orientation: 1,
    ...(infoOpts.colorspace &&
      stream.color_space && { colorspace: stream.color_space }),
    ...(infoOpts.bands && { bands: bandsFromPixFmt(pixFmt) }),
    ...(infoOpts.sampleFormat && {
      sample_format: sampleFormatFromPixFmt(pixFmt, stream.bits_per_raw_sample),
    }),
    ...(infoOpts.pagesNumber && {
      pages_number: parseInt(stream.nb_frames, 10) || 1,
    }),
    ...(infoOpts.alpha && {
      alpha: { alpha: pixFmtHasAlpha(pixFmt) },
    }),
  };

  if (isVideo) {
    const duration = parseFloat(probe.format?.duration);
    if (!isNaN(duration)) {
      result.duration = duration;
    }
    result.video_meta = {
      codec: stream.codec_name,
    };
    const bitrate = parseInt(stream.bit_rate ?? probe.format?.bit_rate, 10);
    if (!isNaN(bitrate)) {
      result.video_meta.bitrate = bitrate;
    }
    const [num, den] = (stream.r_frame_rate ?? "").split("/").map(Number);
    if (num && den) {
      result.video_meta.framerate = Math.round((num / den) * 100) / 100;
    }
  }

  // Size: from buffer if available, otherwise from ffprobe format.size
  const probeSize = parseInt(probe.format?.size, 10);
  if (probeSize > 0) result.size = probeSize;

  // Slow features — each calls getBuffer() on demand, triggering a
  // single download on first use (no download if none are requested).
  if (!isVideo) {
    if (infoOpts.average) {
      try {
        const buf = await getBuffer();
        const img = infoOpts.average.ignoreTransparent
          ? sharp(buf, sharpOpts).removeAlpha()
          : sharp(buf, sharpOpts);
        const stats = await img.stats();
        result.average = {
          R: Math.round(stats.channels[0].mean),
          G: Math.round(stats.channels[1].mean),
          B: Math.round(stats.channels[2].mean),
        };
      } catch (cause) {
        logger.error("Failed to extract average colour", { cause });
      }
    }
    if (infoOpts.dominantColors) {
      try {
        result.dominant_colors = await extractDominantColors(
          await getBuffer(),
          sharpOpts,
        );
      } catch (cause) {
        logger.error("Failed to extract dominant colours", { cause });
      }
    }
    if (infoOpts.palette && infoOpts.palette >= 2) {
      try {
        result.palette = await extractPalette(
          await getBuffer(),
          infoOpts.palette,
          sharpOpts,
        );
      } catch (cause) {
        logger.error("Failed to extract colour palette", { cause });
      }
    }
    if (infoOpts.blurhash) {
      try {
        const buf = await getBuffer();
        const { data, info } = await sharp(buf, sharpOpts)
          .resize(32, 32, { fit: "inside" })
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        result.blurhash = blurhashEncode(
          new Uint8ClampedArray(data),
          info.width,
          info.height,
          infoOpts.blurhash.xComponents,
          infoOpts.blurhash.yComponents,
        );
      } catch (cause) {
        logger.error("Failed to encode blurhash", { cause });
      }
    }
  }

  if (infoOpts.calcHashsums?.length) {
    const buf = await getBuffer();
    result.hashsums = [...new Set(infoOpts.calcHashsums)].reduce(
      (prev, type) => ({
        ...prev,
        [type]: createHash(type).update(buf).digest("hex"),
      }),
      {},
    );
  }

  // Run exiftool for orientation (always) and optional EXIF/IPTC/XMP.
  // If a slow feature already triggered a full download, reuse that buffer
  // instead of making a second request.
  if (!isVideo) {
    try {
      const groups: string[] = ["-Orientation"];
      if (infoOpts.exif) groups.push("-EXIF:all");
      if (infoOpts.iptc) groups.push("-IPTC:all");
      if (infoOpts.xmp) groups.push("-XMP:all");

      const exiftoolSource = getBuffer.pending() ?? sourceUrl;
      const exiftoolResult = await runExiftool(exiftoolSource, groups);

      const rawOrientation = exiftoolResult["IFD0:Orientation"];
      if (typeof rawOrientation === "number") {
        result.orientation = rawOrientation;
        if (rawOrientation >= 5 && rawOrientation <= 8) {
          const w = result.width;
          result.width = result.height;
          result.height = w;
        }
      }

      if (infoOpts.exif) {
        const ifd0 = groupExiftoolOutput(exiftoolResult, "IFD0");
        const exifIFD = groupExiftoolOutput(exiftoolResult, "ExifIFD");
        const gps = groupExiftoolOutput(exiftoolResult, "GPS");
        const exifData: Record<string, unknown> = {};
        if (Object.keys(ifd0).length) exifData.Image = ifd0;
        if (Object.keys(exifIFD).length) exifData.Photo = exifIFD;
        if (Object.keys(gps).length) exifData.GPSInfo = gps;
        result.exif = exifData;
      }

      if (infoOpts.iptc) {
        const iptc = groupExiftoolOutput(exiftoolResult, "IPTC");
        if (Object.keys(iptc).length) result.iptc = iptc;
      }

      if (infoOpts.xmp) {
        const xmp = groupExiftoolXmp(exiftoolResult);
        if (Object.keys(xmp).length) result.xmp = xmp;
      }
    } catch (cause) {
      logger.error("Failed to extract image metadata", { cause });
    }
  }

  return result;
}

export async function handleInfoRequest(
  req: express.Request,
  res: express.Response,
) {
  const infoPath = req.path.replace(/^\/info/, "");

  const pathAfterSignature = verifySignature(infoPath, {
    signingKey: env.SIGNING_KEY,
    signingSalt: env.SIGNING_SALT,
  });

  const parsed = parseInfoUrl(pathAfterSignature, {
    encryptionKey: env.SOURCE_URL_ENCRYPTION_KEY,
  });

  assertOriginAllowed(parsed.sourceUrl);

  if (parsed.expires && Date.now() / 1000 > parsed.expires) {
    throw new HTTPError("URL has expired", { code: "NOT_FOUND" });
  }

  const sourceUrl = parsed.sourceUrl.startsWith("gs://")
    ? await resolveGcsUrl(parsed.sourceUrl)
    : parsed.sourceUrl;

  const getBuffer = createLazyBuffer(sourceUrl);

  if (parsed.hashsum) {
    const buf = await getBuffer();
    const digest = createHash(parsed.hashsum.type).update(buf).digest("hex");
    if (digest !== parsed.hashsum.hash) {
      throw new HTTPError(
        `Source hashsum mismatch: expected ${parsed.hashsum.hash}, got ${digest}`,
        { code: "UNPROCESSABLE_ENTITY" },
      );
    }
  }

  const maxFileSize = parsed.maxSrcFileSize ?? env.MAX_SRC_FILE_SIZE;
  if (maxFileSize) {
    const headRes = await fetch(sourceUrl, { method: "HEAD" });
    const size = parseInt(headRes.headers.get("content-length") ?? "0", 10);
    if (size > maxFileSize) {
      throw new HTTPError(
        `Source file size ${size} exceeds limit of ${maxFileSize} bytes`,
        { code: "UNPROCESSABLE_ENTITY" },
      );
    }
  }

  const metadata = await probeMetadata(
    sourceUrl,
    parsed.infoOptions,
    getBuffer,
  );

  const maxResolution = parsed.maxSrcResolution ?? env.MAX_SRC_RESOLUTION;
  if (maxResolution && metadata.width && metadata.height) {
    const mp = (metadata.width * metadata.height) / 1_000_000;
    if (mp > maxResolution) {
      throw new HTTPError(
        `Source resolution ${mp.toFixed(1)}MP exceeds limit of ${maxResolution}MP`,
        { code: "UNPROCESSABLE_ENTITY" },
      );
    }
  }

  res.set("Cache-Control", env.CACHE_CONTROL);
  res.json(metadata);
}

function assertOriginAllowed(sourceUrl: string): void {
  const { ALLOWED_ORIGINS } = env;
  if (!ALLOWED_ORIGINS) return;

  const origin = extractOrigin(sourceUrl);
  if (!ALLOWED_ORIGINS.has(origin)) {
    throw new HTTPError(`Origin not allowed: ${origin}`, {
      code: "FORBIDDEN",
    });
  }
}

function extractOrigin(sourceUrl: string): string {
  if (sourceUrl.startsWith("gs://")) {
    const bucket = sourceUrl.slice("gs://".length).split("/")[0];
    return `gs://${bucket}`;
  }
  const url = new URL(sourceUrl);
  return url.origin;
}

async function resolveGcsUrl(gsUrl: string): Promise<string> {
  const { Storage } = await import("@google-cloud/storage");
  const gcs = new Storage();
  const withoutScheme = gsUrl.slice("gs://".length);
  const slashIdx = withoutScheme.indexOf("/");
  if (slashIdx === -1) {
    throw new HTTPError("Invalid gs:// URL: missing object path", {
      code: "BAD_REQUEST",
    });
  }

  const bucket = withoutScheme.slice(0, slashIdx);
  const objectPath = withoutScheme.slice(slashIdx + 1);

  const [signedUrl] = await gcs
    .bucket(bucket)
    .file(objectPath)
    .getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 15 * 60 * 1000,
    });

  return signedUrl;
}
