import { spawn } from "node:child_process";
import { open } from "node:fs/promises";

import { logger } from "./logger.js";
import { recordException, tracer } from "./tracing.js";

const HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "mif1",
  "msf1",
  "mif2",
]);

/** Detects HEIF (HEIC) ISOBMFF containers by inspecting the ftyp box. Matches the primary brand and any compatible brand listed after the minor version. Excludes AVIF, which ffmpeg already handles correctly. */
export function isHeifMagic(buf: Buffer): boolean {
  if (buf.length < 16) return false;
  if (buf.subarray(4, 8).toString("ascii") !== "ftyp") return false;
  const primary = buf.subarray(8, 12).toString("ascii");
  if (HEIF_BRANDS.has(primary)) return true;
  for (let i = 16; i + 4 <= buf.length; i += 4) {
    const brand = buf.subarray(i, i + 4).toString("ascii");
    if (HEIF_BRANDS.has(brand)) return true;
  }
  return false;
}

/** Returns true if the file on disk is an HEIF (HEIC) container. */
export async function isHeifFile(path: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, "r");
    const buf = Buffer.alloc(64);
    const { bytesRead } = await handle.read(buf, 0, 64, 0);
    return isHeifMagic(buf.subarray(0, bytesRead));
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

/** True when the URL path has a `.heic` or `.heif` suffix. Cheap pre-check that lets callers skip the remote probe for obvious cases. */
export function looksLikeHeif(sourceUrl: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(sourceUrl).pathname;
  } catch {
    pathname = sourceUrl;
  }
  return /\.(heic|heif)$/i.test(pathname);
}

/** Issues a Range request for the first 64 bytes of the source and checks for an HEIF ftyp signature. Used to catch HEIF files with a non-HEIF extension before committing to ffmpeg's streaming decode path. Failures (origin rejects range, network error) fall through as non-HEIF — the subsequent ffmpeg decode still runs and any real failure surfaces there. */
export async function probeRemoteIsHeif(sourceUrl: string): Promise<boolean> {
  try {
    const res = await fetch(sourceUrl, {
      headers: { Range: "bytes=0-63" },
    });
    if (!res.ok && res.status !== 206) return false;
    const body = Buffer.from(await res.arrayBuffer());
    return isHeifMagic(body.subarray(0, 64));
  } catch {
    return false;
  }
}

/** Decodes a HEIF source to PNG via heif-convert (libheif). Returns undefined on failure so the caller can fall back to passing the original file to ffmpeg. */
export async function decodeHeifToPng(
  sourcePath: string,
): Promise<string | undefined> {
  const span = tracer.startSpan("exec.heif-convert");
  const outPath = `${sourcePath}.decoded.png`;
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("heif-convert", [sourcePath, outPath]);
      let stderr = "";
      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      proc.on("close", (code) => {
        span.setAttribute("process.exit_code", code ?? -1);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`heif-convert exited ${code}: ${stderr.trim()}`));
        }
      });
      proc.on("error", reject);
    });
    return outPath;
  } catch (err) {
    recordException(span, err as Error);
    logger.warn("HEIF pre-decode failed, falling back to ffmpeg", {
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  } finally {
    span.end();
  }
}
