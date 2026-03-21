import { execFile } from "node:child_process";
import express from "express";
import exifReader from "exif-reader";
import sharp from "sharp";
import {
  HTTPError,
  parseProcessingUrl,
  verifySignature,
} from "@socialtip/asset-proxy-url-parser";
import { env } from "./env.js";

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

interface InfoRequestOptions {
  exif?: boolean;
}

interface InfoResponse {
  format: string;
  mime_type: string;
  width: number;
  height: number;
  orientation: number;
  size?: number;
  duration?: number;
  video_meta?: {
    codec: string;
    bitrate?: number;
    framerate?: number;
  };
  exif?: Record<string, unknown>;
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

async function probeMetadata(
  sourceUrl: string,
  infoOpts: InfoRequestOptions = {},
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
  if (!isVideo) {
    try {
      const meta = await sharp(sourceBuffer).metadata();
      orientation = meta.orientation ?? 1;
      if (infoOpts.exif && meta.exif) {
        const parsed = exifReader(meta.exif);
        exifData = sanitiseExif(parsed);
      }
    } catch {
      // orientation/exif extraction is optional — ignore failures
    }
  }
  const swapDimensions = orientation >= 5 && orientation <= 8;

  const result: InfoResponse = {
    format,
    mime_type: mimeType,
    width: swapDimensions ? stream.height : stream.width,
    height: swapDimensions ? stream.width : stream.height,
    orientation,
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

  const { infoOpts, cleanedPath } = parseInfoOptions(pathAfterSignature);

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

const INFO_OPTION_NAMES = new Set(["exif"]);

function parseInfoOptions(path: string): {
  infoOpts: InfoRequestOptions;
  cleanedPath: string;
} {
  const segments = path.split("/").filter(Boolean);
  const infoOpts: InfoRequestOptions = {};
  const kept: string[] = [];

  for (const seg of segments) {
    const colonIdx = seg.indexOf(":");
    const name = colonIdx === -1 ? seg : seg.slice(0, colonIdx);
    if (INFO_OPTION_NAMES.has(name)) {
      const value = colonIdx === -1 ? "" : seg.slice(colonIdx + 1);
      const enabled = value === "1" || value === "t" || value === "true";
      if (name === "exif") infoOpts.exif = enabled;
    } else {
      kept.push(seg);
    }
  }

  return { infoOpts, cleanedPath: "/" + kept.join("/") };
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
