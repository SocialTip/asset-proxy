import { decryptSourceUrl } from "./decrypt.js";

export interface ResizeOptions {
  type: ResizingType;
  width: number;
  height: number;
}

export type ResizingType = "fit" | "fill" | "fill-down" | "force" | "auto";

const VALID_RESIZE_TYPES = new Set<string>([
  "fit",
  "fill",
  "fill-down",
  "force",
  "auto",
]);

export type OutputFormat = "mp4" | "webm";

export interface ParsedUrl {
  resize: ResizeOptions;
  sourceUrl: string;
  framerate?: number;
  trim?: number;
  outputFormat: OutputFormat;
}

/**
 * Parses an imgproxy-format processing path (after signature has been stripped).
 *
 * Supported formats:
 *   /resize:<type>:<width>:<height>/plain/<source_url>[@<format>]
 *   /resize:<type>:<width>:<height>/enc/<encrypted_source_url>[@<format>]
 *
 * Shorthand "rs" is also accepted.
 * Additional options: framerate:<fps> (fr), trim:<seconds> (tr).
 * Output format suffix: @mp4 (default), @webm.
 */
export function parseProcessingUrl(path: string): ParsedUrl {
  const withoutPrefix = path.replace(/^\//, "");

  // Try /plain/ first, then /enc/
  const plainIdx = withoutPrefix.indexOf("/plain/");
  const encIdx = withoutPrefix.indexOf("/enc/");

  let optionsPart: string;
  let sourceUrl: string;
  let encrypted = false;

  if (plainIdx !== -1) {
    optionsPart = withoutPrefix.slice(0, plainIdx);
    sourceUrl = withoutPrefix.slice(plainIdx + "/plain/".length);
  } else if (encIdx !== -1) {
    optionsPart = withoutPrefix.slice(0, encIdx);
    sourceUrl = withoutPrefix.slice(encIdx + "/enc/".length);
    encrypted = true;
  } else {
    throw new Error(
      "Unsupported URL format: expected /plain/ or /enc/ source URL",
    );
  }

  if (!sourceUrl) {
    throw new Error("Missing source URL");
  }

  // Parse output format suffix from the source URL
  let outputFormat: OutputFormat = "mp4";
  const formatMatch = sourceUrl.match(/@(mp4|webm)$/);
  if (formatMatch) {
    outputFormat = formatMatch[1] as OutputFormat;
    sourceUrl = sourceUrl.slice(0, -formatMatch[0].length);
  }

  if (encrypted) {
    sourceUrl = decryptSourceUrl(sourceUrl);
  }

  const options = parseOptions(optionsPart);

  return { ...options, sourceUrl, outputFormat };
}

interface ParsedOptions {
  resize: ResizeOptions;
  framerate?: number;
  trim?: number;
}

function parseOptions(optionsStr: string): ParsedOptions {
  const segments = optionsStr.split("/").filter(Boolean);

  let resize: ResizeOptions | undefined;
  let framerate: number | undefined;
  let trim: number | undefined;

  for (const segment of segments) {
    const parts = segment.split(":");
    const name = parts[0];

    if (name === "resize" || name === "rs") {
      const type = parts[1] || "fit";
      if (!VALID_RESIZE_TYPES.has(type)) {
        throw new Error(`Invalid resizing type: ${type}`);
      }
      resize = {
        type: type as ResizingType,
        width: parseInt(parts[2], 10) || 0,
        height: parseInt(parts[3], 10) || 0,
      };
    } else if (name === "framerate" || name === "fr") {
      const value = parseFloat(parts[1]);
      if (isNaN(value) || value <= 0) {
        throw new Error(`Invalid framerate: ${parts[1]}`);
      }
      framerate = value;
    } else if (name === "trim" || name === "tr") {
      const value = parseFloat(parts[1]);
      if (isNaN(value) || value <= 0) {
        throw new Error(`Invalid trim duration: ${parts[1]}`);
      }
      trim = value;
    }
  }

  if (!resize) {
    throw new Error("No resize option found in URL");
  }

  return { resize, framerate, trim };
}
