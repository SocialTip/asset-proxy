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

export type VideoFormat = "mp4" | "webm";
export type ImageFormat = "jpg" | "png" | "webp" | "avif" | "gif";
export type OutputFormat = VideoFormat | ImageFormat;
export type MediaType = "video" | "image";

const VIDEO_FORMATS = new Set<string>(["mp4", "webm"]);
const IMAGE_FORMATS = new Set<string>(["jpg", "png", "webp", "avif", "gif"]);
const ALL_FORMATS = new Set<string>([...VIDEO_FORMATS, ...IMAGE_FORMATS]);

export type Gravity =
  | "no"
  | "so"
  | "ea"
  | "we"
  | "noea"
  | "nowe"
  | "soea"
  | "sowe"
  | "ce";

export interface ParsedUrl {
  resize?: ResizeOptions;
  sourceUrl: string;
  outputFormat: OutputFormat;
  // Video options
  framerate?: number;
  trim?: number;
  // Image options
  quality?: number;
  blur?: number;
  sharpen?: number;
  rotate?: number;
  autoRotate?: boolean;
  background?: { r: number; g: number; b: number };
  padding?: { top: number; right: number; bottom: number; left: number };
  stripMetadata?: boolean;
  crop?: { width: number; height: number; gravity?: Gravity };
  gravity?: Gravity;
  enlarge?: boolean;
}

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|avif|gif|svg|bmp|tiff?)$/i;

export function inferMediaType(parsed: ParsedUrl): MediaType {
  if (IMAGE_FORMATS.has(parsed.outputFormat)) return "image";
  if (VIDEO_FORMATS.has(parsed.outputFormat)) return "video";
  if (parsed.framerate !== undefined || parsed.trim !== undefined)
    return "video";
  if (IMAGE_EXTENSIONS.test(parsed.sourceUrl)) return "image";
  return "video";
}

/**
 * Parses an imgproxy-format processing path (after signature has been stripped).
 *
 * Supported formats:
 *   /<options>/plain/<source_url>[@<format>]
 *   /<options>/enc/<encrypted_source_url>[@<format>]
 *
 * Processing options include resize (rs), width (w), height (h), framerate (fr),
 * trim (tr), quality (q), blur (bl), sharpen (sh), rotate (rot), auto_rotate (ar),
 * background (bg), padding (pd), strip_metadata (sm), crop (c), gravity (g),
 * enlarge (el), format (f).
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
  const formatMatch = sourceUrl.match(/@([a-z0-9]+)$/);
  if (formatMatch) {
    let fmt = formatMatch[1];
    if (fmt === "jpeg") fmt = "jpg";
    if (ALL_FORMATS.has(fmt)) {
      outputFormat = fmt as OutputFormat;
      sourceUrl = sourceUrl.slice(0, -formatMatch[0].length);
    }
  }

  if (encrypted) {
    sourceUrl = decryptSourceUrl(sourceUrl);
  }

  const options = parseOptions(optionsPart);

  // The format option overrides the @suffix
  if (options.formatOverride) {
    outputFormat = options.formatOverride;
  }

  // If no explicit format and source looks like an image, default to jpg
  if (!formatMatch && !options.formatOverride) {
    if (IMAGE_EXTENSIONS.test(sourceUrl)) {
      outputFormat = "jpg";
    }
  }

  return {
    resize: options.resize,
    sourceUrl,
    outputFormat,
    framerate: options.framerate,
    trim: options.trim,
    quality: options.quality,
    blur: options.blur,
    sharpen: options.sharpen,
    rotate: options.rotate,
    autoRotate: options.autoRotate,
    background: options.background,
    padding: options.padding,
    stripMetadata: options.stripMetadata,
    crop: options.crop,
    gravity: options.gravity,
    enlarge: options.enlarge,
  };
}

const VALID_GRAVITIES = new Set<string>([
  "no",
  "so",
  "ea",
  "we",
  "noea",
  "nowe",
  "soea",
  "sowe",
  "ce",
]);

interface ParsedOptions {
  resize?: ResizeOptions;
  framerate?: number;
  trim?: number;
  quality?: number;
  blur?: number;
  sharpen?: number;
  rotate?: number;
  autoRotate?: boolean;
  background?: { r: number; g: number; b: number };
  padding?: { top: number; right: number; bottom: number; left: number };
  stripMetadata?: boolean;
  crop?: { width: number; height: number; gravity?: Gravity };
  gravity?: Gravity;
  enlarge?: boolean;
  formatOverride?: OutputFormat;
}

function parseBool(v: string | undefined): boolean {
  return v === "1" || v === "t" || v === "true";
}

function parseGravity(v: string | undefined): Gravity | undefined {
  if (!v || !VALID_GRAVITIES.has(v)) return undefined;
  return v as Gravity;
}

function parseOptions(optionsStr: string): ParsedOptions {
  const segments = optionsStr.split("/").filter(Boolean);

  let resize: ResizeOptions | undefined;
  let width: number | undefined;
  let height: number | undefined;
  let framerate: number | undefined;
  let trim: number | undefined;
  let quality: number | undefined;
  let blur: number | undefined;
  let sharpen: number | undefined;
  let rotate: number | undefined;
  let autoRotate: boolean | undefined;
  let background: { r: number; g: number; b: number } | undefined;
  let padding:
    | { top: number; right: number; bottom: number; left: number }
    | undefined;
  let stripMetadata: boolean | undefined;
  let crop: { width: number; height: number; gravity?: Gravity } | undefined;
  let gravity: Gravity | undefined;
  let enlarge: boolean | undefined;
  let formatOverride: OutputFormat | undefined;

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
    } else if (name === "size" || name === "s") {
      width = parseInt(parts[1], 10) || 0;
      height = parseInt(parts[2], 10) || 0;
    } else if (name === "width" || name === "w") {
      width = parseInt(parts[1], 10) || 0;
    } else if (name === "height" || name === "h") {
      height = parseInt(parts[1], 10) || 0;
    } else if (name === "enlarge" || name === "el") {
      enlarge = parseBool(parts[1]);
    } else if (name === "crop" || name === "c") {
      crop = {
        width: parseFloat(parts[1]) || 0,
        height: parseFloat(parts[2]) || 0,
        gravity: parseGravity(parts[3]),
      };
    } else if (name === "gravity" || name === "g") {
      gravity = parseGravity(parts[1]);
    } else if (name === "quality" || name === "q") {
      quality = parseInt(parts[1], 10);
    } else if (name === "blur" || name === "bl") {
      blur = parseFloat(parts[1]);
    } else if (name === "sharpen" || name === "sh") {
      sharpen = parseFloat(parts[1]);
    } else if (name === "rotate" || name === "rot") {
      rotate = parseInt(parts[1], 10) || 0;
    } else if (name === "auto_rotate" || name === "ar") {
      autoRotate = parseBool(parts[1]);
    } else if (name === "background" || name === "bg") {
      background = parseBackground(parts.slice(1));
    } else if (name === "padding" || name === "pd") {
      const top = parseInt(parts[1], 10) || 0;
      const right = parts[2] !== undefined ? parseInt(parts[2], 10) || 0 : top;
      const bottom = parts[3] !== undefined ? parseInt(parts[3], 10) || 0 : top;
      const left = parts[4] !== undefined ? parseInt(parts[4], 10) || 0 : right;
      padding = { top, right, bottom, left };
    } else if (name === "strip_metadata" || name === "sm") {
      stripMetadata = parseBool(parts[1]);
    } else if (name === "format" || name === "f") {
      let fmt = parts[1];
      if (fmt === "jpeg") fmt = "jpg";
      if (ALL_FORMATS.has(fmt)) {
        formatOverride = fmt as OutputFormat;
      }
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

  // Build resize from standalone width/height if no explicit resize segment
  if (!resize && (width || height)) {
    resize = { type: "fit", width: width || 0, height: height || 0 };
  } else if (resize) {
    // Standalone width/height override resize dimensions
    if (width) resize.width = width;
    if (height) resize.height = height;
  }

  return {
    resize,
    framerate,
    trim,
    quality,
    blur,
    sharpen,
    rotate,
    autoRotate,
    background,
    padding,
    stripMetadata,
    crop,
    gravity,
    enlarge,
    formatOverride,
  };
}

function parseBackground(parts: string[]): { r: number; g: number; b: number } {
  if (parts.length === 1) {
    // Hex colour
    const hex = parts[0].replace(/^#/, "");
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
      };
    }
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  return {
    r: parseInt(parts[0], 10) || 0,
    g: parseInt(parts[1], 10) || 0,
    b: parseInt(parts[2], 10) || 0,
  };
}
