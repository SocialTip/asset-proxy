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

  const resize = parseResizeOption(optionsPart);

  return { resize, sourceUrl, outputFormat };
}

function parseResizeOption(optionsStr: string): ResizeOptions {
  const segments = optionsStr.split("/").filter(Boolean);

  for (const segment of segments) {
    const parts = segment.split(":");
    const name = parts[0];

    if (name === "resize" || name === "rs") {
      const type = parts[1] || "fit";
      if (!VALID_RESIZE_TYPES.has(type)) {
        throw new Error(`Invalid resizing type: ${type}`);
      }
      return {
        type: type as ResizingType,
        width: parseInt(parts[2], 10) || 0,
        height: parseInt(parts[3], 10) || 0,
      };
    }
  }

  throw new Error("No resize option found in URL");
}
