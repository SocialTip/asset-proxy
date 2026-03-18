import { z } from "zod/v4";
import { decryptSourceUrl } from "./decrypt.js";
import { HTTPError } from "./error.js";

const resizingType = z.enum(["fit", "fill", "fill-down", "force", "auto"]);
export type ResizingType = z.output<typeof resizingType>;

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
export type VideoFormat = z.output<typeof videoFormat>;
export type ImageFormat = z.output<typeof imageFormat>;
export type OutputFormat = z.output<typeof outputFormat>;

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
export type CompassGravity = z.output<typeof compassGravity>;

const focusPointGravity = z.object({
  type: z.literal("fp"),
  x: z.number(),
  y: z.number(),
});
export type FocusPointGravity = z.output<typeof focusPointGravity>;

const gravitySchema = z.union([compassGravity, focusPointGravity]);
export type Gravity = z.output<typeof gravitySchema>;

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
  /** Resize mode: fit, fill, fill-down, force, or auto. */
  type: resizingType,
  width: z.number(),
  height: z.number(),
});
export type ResizeOptions = z.output<typeof resizeOptions>;

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
  fl: "flip",
  ar: "auto_rotate",
  bg: "background",
  bga: "background_alpha",
  pd: "padding",
  sm: "strip_metadata",
  f: "format",
  fr: "framerate",
  ct: "cut",
  tr: "trim",
  ra: "resizing_algorithm",
  a: "adjust",
  br: "brightness",
  co: "contrast",
  sa: "saturation",
  mc: "monochrome",
  dt: "duotone",
  op: "objects_position",
  // Pro shorthands (parsed but rejected)
  car: "crop_aspect_ratio",
};

const rawOptionsSchema = z
  .object({
    /** Resize with type, width, height. Format: `<type>:<w>:<h>`. */
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

    /** Shorthand for width + height. Format: `<w>:<h>`. */
    size: z
      .string()
      .transform((v) => {
        const [w, h] = v.split(":");
        return { width: parseInt(w, 10) || 0, height: parseInt(h, 10) || 0 };
      })
      .optional(),

    /** Override resize type without specifying dimensions. */
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

    /** Device pixel ratio — multiplies dimensions and padding. */
    dpr: z.coerce.number().positive().optional(),
    /** Allow upscaling smaller images. */
    enlarge: zBool.optional(),

    /** Pad undersized images to fill target dimensions. Format: `<enabled>[:<gravity>]`. */
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
    flip: z
      .string()
      .transform((v) => {
        const [h, vert] = v.split(":");
        return {
          horizontal: h === "1" || h === "t" || h === "true",
          vertical: vert === "1" || vert === "t" || vert === "true",
        };
      })
      .optional(),
    auto_rotate: zBool.optional(),
    background: zBackground.optional(),
    /** Background opacity (0–1). */
    background_alpha: z.coerce.number().min(0).max(1).optional(),

    /** Canvas padding. Format: `<top>[:<right>[:<bottom>[:<left>]]]`. */
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

    /** Output framerate in fps (video only). */
    framerate: zPositiveFloat.optional(),
    /** Limit video duration in seconds (video only). */
    cut: zPositiveFloat.optional(),

    /** Remove uniform borders. Format: `<threshold>[:<colour>[:<equal_hor>[:<equal_vert>]]]`. */
    trim: z
      .string()
      .transform((v) => {
        const [threshold, colour, equalHor, equalVert] = v.split(":");
        return {
          threshold: parseFloat(threshold) || 0,
          colour: colour || undefined,
          equalHor: equalHor === "1" || equalHor === "t" || equalHor === "true",
          equalVert:
            equalVert === "1" || equalVert === "t" || equalVert === "true",
        };
      })
      .optional(),

    resizing_algorithm: zResizingAlgorithm.optional(),

    /** Meta-option: `<brightness>:<contrast>:<saturation>`. */
    adjust: z
      .string()
      .transform((v) => {
        const [b, c, s] = v.split(":");
        return {
          brightness: b ? parseInt(b, 10) : 0,
          contrast: c ? parseFloat(c) : 1,
          saturation: s ? parseFloat(s) : 1,
        };
      })
      .optional(),
    /** Brightness (-255 to 255). */
    brightness: z.coerce.number().int().min(-255).max(255).optional(),
    /** Contrast multiplier (1 = unchanged). */
    contrast: z.coerce.number().positive().optional(),
    /** Saturation multiplier (1 = unchanged). */
    saturation: z.coerce.number().positive().optional(),
    /** Monochrome effect. Format: `<intensity>[:<hex_colour>]`. */
    monochrome: z
      .string()
      .transform((v) => {
        const [intensity, colour] = v.split(":");
        return {
          intensity: parseFloat(intensity) || 0,
          colour: colour || "b3b3b3",
        };
      })
      .optional(),
    /** Duotone effect. Format: `<intensity>[:<shadow_colour>[:<highlight_colour>]]`. */
    duotone: z
      .string()
      .transform((v) => {
        const [intensity, c1, c2] = v.split(":");
        return {
          intensity: parseFloat(intensity) || 0,
          colour1: c1 || "000000",
          colour2: c2 || "ffffff",
        };
      })
      .optional(),

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
    cut: data.cut,
    trim: data.trim,
    brightness: data.brightness ?? data.adjust?.brightness ?? 0,
    contrast: data.contrast ?? data.adjust?.contrast ?? 1,
    saturation: data.saturation ?? data.adjust?.saturation ?? 1,
    monochrome: data.monochrome,
    duotone: data.duotone,
    quality: data.quality,
    blur: data.blur,
    sharpen: data.sharpen,
    rotate: data.rotate,
    flip: data.flip,
    autoRotate: data.auto_rotate,
    background: data.background,
    backgroundAlpha: data.background_alpha,
    padding,
    stripMetadata: data.strip_metadata,
    crop: data.crop,
    cropAspectRatio: data.crop_aspect_ratio,
    gravity: data.gravity,
    enlarge: data.enlarge,
    formatOverride: data.format as OutputFormat | undefined,
  };
});

const parsedUrlSchema = z.object({
  /** Resize dimensions and mode (fit, fill, fill-down, force, auto). */
  resize: resizeOptions.optional(),
  /** The source image/video URL to process. */
  sourceUrl: z.string(),
  /** Output format: jpg, png, webp, avif, gif, mp4, webm. */
  outputFormat,
  /** Minimum output width — upscales if the result would be narrower. */
  minWidth: z.number().optional(),
  /** Minimum output height — upscales if the result would be shorter. */
  minHeight: z.number().optional(),
  /** Pad undersized images to fill the target resize dimensions. */
  extend: z
    .object({ enabled: z.boolean(), gravity: compassGravity })
    .optional(),
  /** Extend the image to match the target aspect ratio. */
  extendAspectRatio: z
    .object({ enabled: z.boolean(), gravity: compassGravity })
    .optional(),
  /** Output framerate in fps (video only). */
  framerate: z.number().optional(),
  /** Limit output duration in seconds (video only). */
  cut: z.number().optional(),
  /** Remove uniform borders from an image via cropdetect. */
  trim: z
    .object({
      /** Colour similarity tolerance (0–255). */
      threshold: z.number(),
      /** Hex colour to trim. Auto-detected if omitted. */
      colour: z.string().optional(),
      /** Trim equal amounts from left and right. */
      equalHor: z.boolean(),
      /** Trim equal amounts from top and bottom. */
      equalVert: z.boolean(),
    })
    .optional(),
  /** Brightness adjustment (-255 to 255, 0 = no change). */
  brightness: z.number(),
  /** Contrast multiplier (1 = no change). */
  contrast: z.number(),
  /** Saturation multiplier (1 = no change). */
  saturation: z.number(),
  /** Convert to monochrome with optional intensity and base colour. */
  monochrome: z
    .object({ intensity: z.number(), colour: z.string() })
    .optional(),
  /** Apply duotone effect with two colours. */
  duotone: z
    .object({
      intensity: z.number(),
      colour1: z.string(),
      colour2: z.string(),
    })
    .optional(),
  /** Output quality 1–100 for lossy formats (JPEG, WebP, AVIF). */
  quality: z.number().optional(),
  /** Gaussian blur sigma. */
  blur: z.number().optional(),
  /** Sharpening sigma. */
  sharpen: z.number().optional(),
  /** Rotation angle: 0, 90, 180, or 270 degrees. */
  rotate: z.number().optional(),
  /** Flip the image horizontally and/or vertically. */
  flip: z.object({ horizontal: z.boolean(), vertical: z.boolean() }).optional(),
  /** Rotate based on EXIF orientation data. */
  autoRotate: z.boolean().optional(),
  /** Background colour (RGB) for padding, extend, and alpha flattening. */
  background: rgb.optional(),
  /** Background opacity (0–1). */
  backgroundAlpha: z.number().optional(),
  /** Canvas padding in pixels: top, right, bottom, left. */
  padding: sides.optional(),
  /** Remove EXIF and other metadata from the output. */
  stripMetadata: z.boolean().optional(),
  /** Extract a region before resizing (width, height, optional gravity). */
  crop: z
    .object({
      width: z.number(),
      height: z.number(),
      gravity: gravitySchema.optional(),
    })
    .optional(),
  /** Crop to a target aspect ratio (width/height as a float). */
  cropAspectRatio: z.number().optional(),
  /** Anchor point for crop: compass direction or focus point. */
  gravity: gravitySchema.optional(),
  /** Allow upscaling when the image is smaller than the target. */
  enlarge: z.boolean().optional(),
});

type ParsedUrlBase = z.output<typeof parsedUrlSchema>;

/** Fully parsed URL including fields not validated by the Zod schema. */
export type ParsedUrl = ParsedUrlBase & {
  /** Scaling algorithm — CPU (sws_flags) or GPU (scale_cuda/scale_npp). */
  resizingAlgorithm?: ResizingAlgorithm;
};

export type ImageUrl = ParsedUrl & { outputFormat: ImageFormat };
export type VideoUrl = ParsedUrl & { outputFormat: VideoFormat };

export function isImageUrl(parsed: ParsedUrl): parsed is ImageUrl {
  if (IMAGE_FORMATS.has(parsed.outputFormat)) return true;
  if (VIDEO_FORMATS.has(parsed.outputFormat)) return false;
  if (parsed.framerate !== undefined || parsed.cut !== undefined) return false;
  if (IMAGE_EXTENSIONS.test(parsed.sourceUrl)) return true;
  return false;
}

export function isVideoUrl(parsed: ParsedUrl): parsed is VideoUrl {
  return !isImageUrl(parsed);
}

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

  const parsed = parsedUrlSchema.parse({
    resize: options.resize,
    sourceUrl,
    outputFormat: format,
    minWidth: options.minWidth,
    minHeight: options.minHeight,
    extend: options.extend,
    extendAspectRatio: options.extendAspectRatio,
    framerate: options.framerate,
    cut: options.cut,
    trim: options.trim,
    brightness: options.brightness,
    contrast: options.contrast,
    saturation: options.saturation,
    monochrome: options.monochrome,
    duotone: options.duotone,
    quality: options.quality,
    blur: options.blur,
    sharpen: options.sharpen,
    rotate: options.rotate,
    flip: options.flip,
    autoRotate: options.autoRotate,
    background: options.background,
    backgroundAlpha: options.backgroundAlpha,
    padding: options.padding,
    stripMetadata: options.stripMetadata,
    crop: options.crop,
    cropAspectRatio: options.cropAspectRatio,
    gravity: options.gravity,
    enlarge: options.enlarge,
  });

  return {
    ...parsed,
    resizingAlgorithm: options.resizingAlgorithm,
  };
}
