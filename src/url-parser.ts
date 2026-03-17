import { z } from "zod/v4";
import { decryptSourceUrl } from "./decrypt.js";
import { HTTPError } from "./error.js";

// ── Zod enums & primitives ───────────────────────────────────────────────────

const resizingType = z.enum(["fit", "fill", "fill-down", "force", "auto"]);
export type ResizingType = z.infer<typeof resizingType>;

const cpuAlgorithms = [
  "nearest",
  "linear",
  "cubic",
  "lanczos2",
  "lanczos3",
] as const;
const gpuScalers = ["scale_cuda", "scale_npp"] as const;
type CpuAlgorithm = (typeof cpuAlgorithms)[number];
type GpuScaler = (typeof gpuScalers)[number];

export type ResizingAlgorithm =
  | { mode: "cpu"; algorithm: CpuAlgorithm }
  | { mode: "gpu"; scaler: GpuScaler; algorithm?: CpuAlgorithm };

const cpuAlgorithmSet = new Set<string>(cpuAlgorithms);
const gpuScalerSet = new Set<string>(gpuScalers);

const zResizingAlgorithm = z.string().transform((v): ResizingAlgorithm => {
  if (v.startsWith("gpu:")) {
    const parts = v.slice(4).split(":");
    const scaler = parts[0];
    if (!gpuScalerSet.has(scaler)) {
      throw new HTTPError(
        `Invalid GPU scaler '${scaler}': expected one of ${gpuScalers.join(", ")}`,
        { code: "BAD_REQUEST" },
      );
    }
    const algo = parts[1];
    if (algo !== undefined) {
      if (!cpuAlgorithmSet.has(algo)) {
        throw new HTTPError(
          `Invalid interpolation algorithm '${algo}': expected one of ${cpuAlgorithms.join(", ")}`,
          { code: "BAD_REQUEST" },
        );
      }
      if (scaler !== "scale_npp") {
        throw new HTTPError(
          "Interpolation algorithm is only supported with scale_npp",
          { code: "BAD_REQUEST" },
        );
      }
      return {
        mode: "gpu",
        scaler: scaler as GpuScaler,
        algorithm: algo as CpuAlgorithm,
      };
    }
    return { mode: "gpu", scaler: scaler as GpuScaler };
  }
  if (!cpuAlgorithmSet.has(v)) {
    throw new HTTPError(
      `Invalid resizing algorithm '${v}': expected one of ${cpuAlgorithms.join(", ")} or gpu:<scaler>[:<algorithm>]`,
      { code: "BAD_REQUEST" },
    );
  }
  return { mode: "cpu", algorithm: v as CpuAlgorithm };
});

const videoFormat = z.enum(["mp4", "webm"]);
const imageFormat = z.enum(["jpg", "png", "webp", "avif", "gif"]);
const outputFormat = z.union([videoFormat, imageFormat]);
export type VideoFormat = z.infer<typeof videoFormat>;
export type ImageFormat = z.infer<typeof imageFormat>;
export type OutputFormat = z.infer<typeof outputFormat>;

export type MediaType = "video" | "image";

const compassGravity = z.enum([
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
export type CompassGravity = z.infer<typeof compassGravity>;

export type FocusPointGravity = { type: "fp"; x: number; y: number };
export type Gravity = CompassGravity | FocusPointGravity;

const zGravity = z.string().transform((v): Gravity => {
  if (v.startsWith("fp:")) {
    const [, xStr, yStr] = v.split(":");
    const x = parseFloat(xStr);
    const y = parseFloat(yStr);
    if (
      Number.isNaN(x) ||
      Number.isNaN(y) ||
      x < 0 ||
      x > 1 ||
      y < 0 ||
      y > 1
    ) {
      throw new HTTPError(
        "Focus point gravity requires x and y values between 0 and 1: gravity:fp:<x>:<y>",
        { code: "BAD_REQUEST" },
      );
    }
    return { type: "fp", x, y };
  }
  if (v.startsWith("sm") || v.startsWith("obj")) {
    throw new HTTPError(
      `Gravity type '${v.split(":")[0]}' is not implemented`,
      {
        code: "BAD_REQUEST",
      },
    );
  }
  return compassGravity.parse(v);
});

const rgb = z.object({ r: z.number(), g: z.number(), b: z.number() });
const sides = z.object({
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
  left: z.number(),
});

const resizeOptions = z.object({
  type: resizingType,
  width: z.number(),
  height: z.number(),
});
export type ResizeOptions = z.infer<typeof resizeOptions>;

const zBool = z
  .string()
  .transform((v) => v === "1" || v === "t" || v === "true");

const zPositiveFloat = z.coerce.number().positive();

const zBackground = z.string().transform((v) => {
  const parts = v.split(":");
  if (parts.length === 1) {
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
});

/** Schema for options that are recognised but not yet implemented. */
const notImplemented = (name: string) =>
  z.string().transform(() => {
    throw new HTTPError(`Option '${name}' is not implemented`, {
      code: "BAD_REQUEST",
    });
  });

// ── Constants ────────────────────────────────────────────────────────────────

const VIDEO_FORMATS = new Set<string>(["mp4", "webm"]);
const IMAGE_FORMATS = new Set<string>(["jpg", "png", "webp", "avif", "gif"]);
const ALL_FORMATS = new Set<string>([...VIDEO_FORMATS, ...IMAGE_FORMATS]);
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|avif|gif|svg|bmp|tiff?)$/i;

const SHORTHANDS: Record<string, string> = {
  rs: "resize",
  s: "size",
  t: "resizing_type",
  w: "width",
  h: "height",
  mw: "min_width",
  mh: "min_height",
  z: "zoom",
  el: "enlarge",
  ex: "extend",
  exar: "extend_aspect_ratio",
  c: "crop",
  g: "gravity",
  q: "quality",
  bl: "blur",
  sh: "sharpen",
  rot: "rotate",
  ar: "auto_rotate",
  bg: "background",
  pd: "padding",
  sm: "strip_metadata",
  f: "format",
  fr: "framerate",
  tr: "trim",
  ra: "resizing_algorithm",
  op: "objects_position",
  // Pro shorthands (parsed but rejected)
  car: "crop_aspect_ratio",
};

// ── Options schema (raw segments → canonical options) ────────────────────────

const rawOptionsSchema = z
  .object({
    resize: z
      .string()
      .transform((v) => {
        const [type = "fit", w, h] = v.split(":");
        return {
          type: resizingType.parse(type),
          width: parseInt(w, 10) || 0,
          height: parseInt(h, 10) || 0,
        };
      })
      .optional(),

    size: z
      .string()
      .transform((v) => {
        const [w, h] = v.split(":");
        return { width: parseInt(w, 10) || 0, height: parseInt(h, 10) || 0 };
      })
      .optional(),

    resizing_type: resizingType.optional(),
    width: z.coerce.number().int().optional(),
    height: z.coerce.number().int().optional(),
    min_width: z.coerce.number().int().optional(),
    min_height: z.coerce.number().int().optional(),

    zoom: z
      .string()
      .transform((v) => {
        const parts = v.split(":");
        const x = parseFloat(parts[0]) || 1;
        const y = parts[1] !== undefined ? parseFloat(parts[1]) || 1 : x;
        return { x, y };
      })
      .optional(),

    dpr: z.coerce.number().positive().optional(),
    enlarge: zBool.optional(),

    extend: z
      .string()
      .transform((v) => {
        const parts = v.split(":");
        const enabled =
          parts[0] === "1" || parts[0] === "t" || parts[0] === "true";
        return {
          enabled,
          gravity: compassGravity.safeParse(parts[1]).data ?? ("ce" as const),
        };
      })
      .optional(),

    extend_aspect_ratio: z
      .string()
      .transform((v) => {
        const parts = v.split(":");
        const enabled =
          parts[0] === "1" || parts[0] === "t" || parts[0] === "true";
        return {
          enabled,
          gravity: compassGravity.safeParse(parts[1]).data ?? ("ce" as const),
        };
      })
      .optional(),

    crop: z
      .string()
      .transform((v) => {
        const [w, h, ...rest] = v.split(":");
        const gStr = rest.join(":");
        let cropGravity: Gravity | undefined;
        if (gStr) {
          cropGravity = zGravity.parse(gStr);
        }
        return {
          width: parseFloat(w) || 0,
          height: parseFloat(h) || 0,
          gravity: cropGravity,
        };
      })
      .optional(),

    gravity: zGravity.optional(),
    quality: z.coerce.number().int().optional(),
    blur: z.coerce.number().optional(),
    sharpen: z.coerce.number().optional(),
    rotate: z.coerce.number().int().optional(),
    auto_rotate: zBool.optional(),
    background: zBackground.optional(),

    padding: z
      .string()
      .transform((v) => {
        const parts = v.split(":").map((p) => parseInt(p, 10) || 0);
        const top = parts[0];
        const right = parts[1] ?? top;
        const bottom = parts[2] ?? top;
        const left = parts[3] ?? right;
        return { top, right, bottom, left };
      })
      .optional(),

    strip_metadata: zBool.optional(),

    format: z
      .string()
      .transform((v) => (v === "jpeg" ? "jpg" : v))
      .pipe(z.string().refine((v) => ALL_FORMATS.has(v)))
      .optional(),

    framerate: zPositiveFloat.optional(),
    trim: zPositiveFloat.optional(),

    resizing_algorithm: zResizingAlgorithm.optional(),
    objects_position: notImplemented("objects_position").optional(),
    crop_aspect_ratio: z
      .string()
      .transform((v) => {
        const [w, h] = v.split(":");
        const width = parseFloat(w);
        const height = parseFloat(h);
        if (!width || !height || width <= 0 || height <= 0) {
          throw new HTTPError(
            "crop_aspect_ratio requires two positive numbers: car:<width>:<height>",
            { code: "BAD_REQUEST" },
          );
        }
        return width / height;
      })
      .optional(),
  })
  .passthrough();

const optionsSchema = rawOptionsSchema.transform((data) => {
  let resizeType = data.resize?.type ?? data.resizing_type ?? ("fit" as const);
  let resize = data.resize;
  const w = data.size?.width ?? data.width;
  const h = data.size?.height ?? data.height;

  // Apply standalone resizing_type
  if (data.resizing_type && resize) {
    resize = { ...resize, type: data.resizing_type };
    resizeType = data.resizing_type;
  }

  if (!resize && (w || h)) {
    resize = { type: resizeType, width: w ?? 0, height: h ?? 0 };
  } else if (resize) {
    if (w) resize.width = w;
    if (h) resize.height = h;
  }

  // Apply zoom multiplier to dimensions
  if (data.zoom && resize) {
    resize = {
      ...resize,
      width: resize.width ? Math.round(resize.width * data.zoom.x) : 0,
      height: resize.height ? Math.round(resize.height * data.zoom.y) : 0,
    };
  }

  // Apply dpr multiplier to dimensions and padding
  let padding = data.padding;
  if (data.dpr && data.dpr !== 1) {
    const d = data.dpr;
    if (resize) {
      resize = {
        ...resize,
        width: resize.width ? Math.round(resize.width * d) : 0,
        height: resize.height ? Math.round(resize.height * d) : 0,
      };
    }
    if (padding) {
      padding = {
        top: Math.round(padding.top * d),
        right: Math.round(padding.right * d),
        bottom: Math.round(padding.bottom * d),
        left: Math.round(padding.left * d),
      };
    }
  }

  return {
    resize,
    resizingAlgorithm: data.resizing_algorithm,
    minWidth: data.min_width,
    minHeight: data.min_height,
    extend: data.extend,
    extendAspectRatio: data.extend_aspect_ratio,
    framerate: data.framerate,
    trim: data.trim,
    quality: data.quality,
    blur: data.blur,
    sharpen: data.sharpen,
    rotate: data.rotate,
    autoRotate: data.auto_rotate,
    background: data.background,
    padding,
    stripMetadata: data.strip_metadata,
    crop: data.crop,
    cropAspectRatio: data.crop_aspect_ratio,
    gravity: data.gravity,
    enlarge: data.enlarge,
    formatOverride: data.format as OutputFormat | undefined,
  };
});

// ── ParsedUrl schema ─────────────────────────────────────────────────────────

const parsedUrlSchema = z.object({
  resize: resizeOptions.optional(),
  resizingAlgorithm: z.any().optional(),
  sourceUrl: z.string(),
  outputFormat,
  minWidth: z.number().optional(),
  minHeight: z.number().optional(),
  extend: z
    .object({ enabled: z.boolean(), gravity: compassGravity })
    .optional(),
  extendAspectRatio: z
    .object({ enabled: z.boolean(), gravity: compassGravity })
    .optional(),
  framerate: z.number().optional(),
  trim: z.number().optional(),
  quality: z.number().optional(),
  blur: z.number().optional(),
  sharpen: z.number().optional(),
  rotate: z.number().optional(),
  autoRotate: z.boolean().optional(),
  background: rgb.optional(),
  padding: sides.optional(),
  stripMetadata: z.boolean().optional(),
  crop: z
    .object({
      width: z.number(),
      height: z.number(),
      gravity: z.any().optional(),
    })
    .optional(),
  cropAspectRatio: z.number().optional(),
  gravity: z.any().optional(),
  enlarge: z.boolean().optional(),
});

export type ParsedUrl = z.infer<typeof parsedUrlSchema>;

export type ImageUrl = ParsedUrl & { outputFormat: ImageFormat };
export type VideoUrl = ParsedUrl & { outputFormat: VideoFormat };

export function isImageUrl(parsed: ParsedUrl): parsed is ImageUrl {
  if (IMAGE_FORMATS.has(parsed.outputFormat)) return true;
  if (VIDEO_FORMATS.has(parsed.outputFormat)) return false;
  if (parsed.framerate !== undefined || parsed.trim !== undefined) return false;
  if (IMAGE_EXTENSIONS.test(parsed.sourceUrl)) return true;
  return false;
}

export function isVideoUrl(parsed: ParsedUrl): parsed is VideoUrl {
  return !isImageUrl(parsed);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parses an imgproxy-format processing path (after signature has been stripped).
 *
 * Supported formats:
 *   /<options>/plain/<source_url>[@<format>]
 *   /<options>/enc/<encrypted_source_url>[@<format>]
 */
export function parseProcessingUrl(path: string): ParsedUrl {
  const withoutPrefix = path.replace(/^\//, "");

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

  // Parse @format suffix from source URL
  let format: OutputFormat = "mp4";
  let hasFormatSuffix = false;
  const formatMatch = sourceUrl.match(/@([a-z0-9]+)$/);
  if (formatMatch) {
    let fmt = formatMatch[1];
    if (fmt === "jpeg") fmt = "jpg";
    if (ALL_FORMATS.has(fmt)) {
      format = fmt as OutputFormat;
      sourceUrl = sourceUrl.slice(0, -formatMatch[0].length);
      hasFormatSuffix = true;
    }
  }

  if (encrypted) {
    sourceUrl = decryptSourceUrl(sourceUrl);
  }

  // Parse option segments into a { name: value } record, then validate with Zod
  const raw = Object.fromEntries(
    optionsPart
      .split("/")
      .filter(Boolean)
      .map((segment) => {
        const idx = segment.indexOf(":");
        if (idx === -1) return [segment, ""];
        const name = segment.slice(0, idx);
        const value = segment.slice(idx + 1);
        return [SHORTHANDS[name] ?? name, value];
      }),
  );

  const options = optionsSchema.parse(raw);

  if (options.formatOverride) {
    format = options.formatOverride;
  }

  if (!hasFormatSuffix && !options.formatOverride) {
    if (IMAGE_EXTENSIONS.test(sourceUrl)) {
      format = "jpg";
    }
  }

  return parsedUrlSchema.parse({
    resize: options.resize,
    resizingAlgorithm: options.resizingAlgorithm,
    sourceUrl,
    outputFormat: format,
    minWidth: options.minWidth,
    minHeight: options.minHeight,
    extend: options.extend,
    extendAspectRatio: options.extendAspectRatio,
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
    cropAspectRatio: options.cropAspectRatio,
    gravity: options.gravity,
    enlarge: options.enlarge,
  });
}
