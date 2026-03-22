import { execFile } from "node:child_process";
import express from "express";
import { encode as blurhashEncode } from "blurhash";
import exifReader from "exif-reader";
import { XMLParser } from "fast-xml-parser";
import nodeIptc from "node-iptc";
import sharp from "sharp";
import {
  HTTPError,
  parseInfoOptions,
  parseProcessingUrl,
  verifySignature,
  type InfoOptions,
} from "@socialtip/asset-proxy-url-parser";
import { env } from "./env.js";
import { logger } from "./logger.js";

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
  iptc?: Record<string, string | string[]>;
  xmp?: Record<string, Record<string, unknown>>;
  palette?: Array<{ R: number; G: number; B: number; A: number }>;
  average?: { R: number; G: number; B: number };
  dominant_colors?: Record<string, { R: number; G: number; B: number }>;
  blurhash?: string;
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
): Promise<Record<string, RGB>> {
  const quantised = await sharp(buf)
    .removeAlpha()
    .png({ palette: true, colours: 64, effort: 1 })
    .toBuffer();
  const { data, info } = await sharp(quantised)
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Count pixel frequency per quantised colour
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

  // Pick the most frequent colour matching a filter
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
): Promise<Array<{ R: number; G: number; B: number; A: number }>> {
  const quantised = await sharp(buf)
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

async function probeMetadata(
  sourceUrl: string,
  infoOpts: InfoOptions = {},
): Promise<InfoResponse> {
  const sourceRes = await fetch(sourceUrl);
  if (!sourceRes.ok) {
    throw new HTTPError("Could not fetch source", {
      code: "UNPROCESSABLE_ENTITY",
    });
  }
  const sourceBuffer = Buffer.from(await sourceRes.arrayBuffer());

  const { stdout } = await new Promise<{ stdout: string }>(
    (resolve, reject) => {
      const proc = execFile(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_format",
          "-show_streams",
          "-of",
          "json",
          "-i",
          "pipe:0",
        ],
        (err, stdout) => (err ? reject(err) : resolve({ stdout })),
      );
      proc.stdin!.end(sourceBuffer);
    },
  );

  const probe = JSON.parse(stdout);
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

  let orientation = 1;
  let exifData: Record<string, unknown> | undefined;
  let iptcData: Record<string, string | string[]> | undefined;
  let xmpData: Record<string, Record<string, unknown>> | undefined;
  let averageData: { R: number; G: number; B: number } | undefined;
  let blurhashData: string | undefined;
  let dominantColorsData:
    | Record<string, { R: number; G: number; B: number }>
    | undefined;
  let paletteData:
    | Array<{ R: number; G: number; B: number; A: number }>
    | undefined;
  if (!isVideo) {
    try {
      const meta = await sharp(sourceBuffer).metadata();
      orientation = meta.orientation ?? 1;
      if (infoOpts.exif && meta.exif) {
        const parsed = exifReader(meta.exif);
        exifData = sanitiseExif(parsed);
      }
      if (infoOpts.iptc) {
        const parsed = nodeIptc(sourceBuffer);
        if (parsed) iptcData = parsed;
      }
      if (infoOpts.xmp && meta.xmp) {
        xmpData = parseXmp(meta.xmp);
      }
    } catch (cause) {
      logger.error("Failed to extract image metadata", { cause });
    }
    if (infoOpts.average) {
      try {
        const img = infoOpts.average.ignoreTransparent
          ? sharp(sourceBuffer).removeAlpha()
          : sharp(sourceBuffer);
        const stats = await img.stats();
        averageData = {
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
        dominantColorsData = await extractDominantColors(sourceBuffer);
      } catch (cause) {
        logger.error("Failed to extract dominant colours", { cause });
      }
    }
    if (infoOpts.palette && infoOpts.palette >= 2) {
      try {
        paletteData = await extractPalette(sourceBuffer, infoOpts.palette);
      } catch (cause) {
        logger.error("Failed to extract colour palette", { cause });
      }
    }
    if (infoOpts.blurhash) {
      try {
        const { data, info } = await sharp(sourceBuffer)
          .resize(32, 32, { fit: "inside" })
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        blurhashData = blurhashEncode(
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
  const swapDimensions = orientation >= 5 && orientation <= 8;

  const pixFmt: string = stream.pix_fmt ?? "";

  const result: InfoResponse = {
    format,
    mime_type: mimeType,
    width: swapDimensions ? stream.height : stream.width,
    height: swapDimensions ? stream.width : stream.height,
    orientation,
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

  result.size = sourceBuffer.length;

  if (exifData) {
    result.exif = exifData;
  }
  if (iptcData) {
    result.iptc = iptcData;
  }
  if (xmpData) {
    result.xmp = xmpData;
  }
  if (averageData) {
    result.average = averageData;
  }
  if (dominantColorsData) {
    result.dominant_colors = dominantColorsData;
  }
  if (blurhashData) {
    result.blurhash = blurhashData;
  }
  if (paletteData) {
    result.palette = paletteData;
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

  const { infoOptions: infoOpts, cleanedPath } =
    parseInfoOptions(pathAfterSignature);

  // parseProcessingUrl expects at least one option segment before /plain/ or /enc/.
  // When no options are present the path starts with /plain/ directly, so we
  // prepend a no-op segment to satisfy the parser.
  const parserPath =
    cleanedPath.startsWith("/plain/") || cleanedPath.startsWith("/enc/")
      ? `/_${cleanedPath}`
      : cleanedPath;

  const parsed = parseProcessingUrl(parserPath, {
    encryptionKey: env.SOURCE_URL_ENCRYPTION_KEY,
  });

  assertOriginAllowed(parsed.sourceUrl);

  if (parsed.expires && Date.now() / 1000 > parsed.expires) {
    throw new HTTPError("URL has expired", { code: "NOT_FOUND" });
  }

  const sourceUrl = parsed.sourceUrl.startsWith("gs://")
    ? await resolveGcsUrl(parsed.sourceUrl)
    : parsed.sourceUrl;

  const metadata = await probeMetadata(sourceUrl, infoOpts);

  res.set("Cache-Control", env.CACHE_CONTROL);
  res.json(metadata);
}

const EXIF_INTERNAL_KEYS = new Set(["bigEndian", "ExifTag", "GPSTag"]);

function sanitiseExif(
  parsed: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [section, values] of Object.entries(parsed)) {
    if (typeof values !== "object" || values === null) continue;
    if (EXIF_INTERNAL_KEYS.has(section)) continue;
    result[section] = sanitiseExifValues(values as Record<string, unknown>);
  }
  return result;
}

function sanitiseExifValues(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (EXIF_INTERNAL_KEYS.has(key)) continue;
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      const buf = Buffer.from(value);
      // Use ASCII if all bytes are printable, otherwise hex
      const isPrintable = buf.every((b) => b >= 0x20 && b <= 0x7e);
      result[key] = isPrintable ? buf.toString("ascii") : buf.toString("hex");
    } else {
      result[key] = value;
    }
  }
  return result;
}

const xmpParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: false,
});

function parseXmp(
  buf: Buffer,
): Record<string, Record<string, unknown>> | undefined {
  const xml = Buffer.from(buf).toString("utf8");
  const parsed = xmpParser.parse(xml);
  const desc = parsed["x:xmpmeta"]?.["rdf:RDF"]?.["rdf:Description"];
  if (!desc || typeof desc !== "object") return undefined;

  const result: Record<string, Record<string, unknown>> = {};

  for (const [key, value] of Object.entries(desc)) {
    if (key.startsWith("@_")) continue;
    const colonIdx = key.indexOf(":");
    if (colonIdx === -1) continue;

    const ns = key.slice(0, colonIdx);
    const field = key.slice(colonIdx + 1);
    if (!result[ns]) result[ns] = {};
    result[ns][field] = flattenRdfValue(value);
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function flattenRdfValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  const obj = value as Record<string, unknown>;
  // rdf:Seq, rdf:Bag → array
  const seq = obj["rdf:Seq"] ?? obj["rdf:Bag"];
  if (seq && typeof seq === "object") {
    const items = (seq as Record<string, unknown>)["rdf:li"];
    if (Array.isArray(items)) return items.map(flattenRdfValue);
    return [flattenRdfValue(items)];
  }
  // rdf:Alt → first value (language alternative)
  const alt = obj["rdf:Alt"];
  if (alt && typeof alt === "object") {
    const li = (alt as Record<string, unknown>)["rdf:li"];
    if (li && typeof li === "object" && "#text" in (li as object)) {
      return (li as Record<string, unknown>)["#text"];
    }
    return li;
  }
  return value;
}

// Re-import helpers from main module would create a circular dependency,
// so we duplicate the small helpers here.

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
