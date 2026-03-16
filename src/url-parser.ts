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

export interface ParsedUrl {
  resize: ResizeOptions;
  sourceUrl: string;
}

/**
 * Parses an imgproxy-format URL path.
 *
 * Expected format:
 *   /insecure/resize:<type>:<width>:<height>/plain/<source_url>
 *
 * Shorthand "rs" is also accepted:
 *   /insecure/rs:<type>:<width>:<height>/plain/<source_url>
 */
export function parseProcessingUrl(path: string): ParsedUrl {
  const withoutPrefix = path.replace(/^\/insecure\//, "");

  const plainIdx = withoutPrefix.indexOf("/plain/");
  if (plainIdx === -1) {
    throw new Error(
      "Unsupported URL format: only /plain/ source URLs are supported",
    );
  }

  const optionsPart = withoutPrefix.slice(0, plainIdx);
  const sourceUrl = withoutPrefix.slice(plainIdx + "/plain/".length);

  if (!sourceUrl) {
    throw new Error("Missing source URL");
  }

  const resize = parseResizeOption(optionsPart);

  return { resize, sourceUrl };
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
