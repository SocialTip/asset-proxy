import { z } from "zod/v4";

import { decryptSourceUrl } from "./crypto.js";
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
const gpuScalers = ["scale_cuda", "scale_npp", "cuvid"] as const;
type CpuAlgorithm = (typeof cpuAlgorithms)[number];
type GpuScaler = (typeof gpuScalers)[number];

export type ResizingAlgorithm =
  | { mode: "cpu"; algorithm: CpuAlgorithm }
  | { mode: "gpu"; scaler: GpuScaler; algorithm?: CpuAlgorithm };

const cpuAlgorithmSet = new Set<string>(cpuAlgorithms);
const gpuScalerSet = new Set<string>(gpuScalers);

const resizingAlgorithmSchema = z.union([
  z.object({
    mode: z.literal("cpu"),
    algorithm: z.enum(cpuAlgorithms),
  }),
  z.object({
    mode: z.literal("gpu"),
    scaler: z.enum(gpuScalers),
    algorithm: z.enum(cpuAlgorithms).optional(),
  }),
]);

const zResizingAlgorithm = z.string().transform((v): ResizingAlgorithm => {
  if (v === "gpu") {
    return { mode: "gpu", scaler: "scale_cuda" };
  }
  if (v.startsWith("gpu:")) {
    const parts = v.slice(4).split(":");
    const scaler = parts[0] || "scale_cuda";
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
          `Interpolation algorithm is only supported with scale_npp (got ${scaler})`,
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

const videoFormat = z.enum(["mp4", "fmp4", "webm"]);
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
        code: "NOT_IMPLEMENTED",
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
      code: "NOT_IMPLEMENTED",
    });
  });

const VIDEO_FORMATS = new Set<string>(["mp4", "fmp4", "webm"]);
const IMAGE_FORMATS = new Set<string>(["jpg", "png", "webp", "avif", "gif"]);
const ALL_FORMATS = new Set<string>([...VIDEO_FORMATS, ...IMAGE_FORMATS]);
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|avif|gif|svg|bmp|tiff?)$/i;

export const SHORTHANDS: Record<string, string> = {
  rs: "resize",
  s: "size",
  t: "resizing_type",
  rt: "resizing_type",
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
  kcr: "keep_copyright",
  scp: "strip_color_profile",
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
  px: "pixelate",
  ush: "unsharp_masking",
  bla: "blur_areas",
  bd: "blur_detections",
  dd: "draw_detections",
  clrz: "colorize",
  col: "colorize",
  grd: "gradient",
  gr: "gradient",
  wm: "watermark",
  wmu: "watermark_url",
  wmt: "watermark_text",
  wms: "watermark_size",
  wmr: "watermark_rotate",
  wmsh: "watermark_shadow",
  st: "style",
  eth: "enforce_thumbnail",
  pg: "page",
  pgs: "pages",
  da: "disable_animation",
  vts: "video_thumbnail_second",
  vtk: "video_thumbnail_keyframes",
  vtt: "video_thumbnail_tile",
  vta: "video_thumbnail_animation",
  fq: "format_quality",
  jpgo: "jpeg_options",
  pngo: "png_options",
  wpo: "webp_options",
  avo: "avif_options",
  aq: "autoquality",
  mb: "max_bytes",
  op: "objects_position",
  car: "crop_aspect_ratio",
  skp: "skip_processing",
  cb: "cache_buster",
  exp: "expires",
  fn: "filename",
  att: "return_attachment",
  pr: "preset",
  fiu: "fallback_image_url",
  hs: "hashsum",
  mu: "mute",
  cdc: "codec",
  cors: "cors",
  msr: "max_src_resolution",
  msfs: "max_src_file_size",
  maf: "max_animation_frames",
  mafr: "max_animation_frame_resolution",
  mrd: "max_result_dimension",
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
    /** Preserve copyright metadata when stripping. */
    keep_copyright: zBool.optional(),
    /** Convert ICC colour profile to sRGB and remove it. */
    strip_color_profile: zBool.optional(),

    format: z
      .string()
      .transform((v) => (v === "jpeg" ? "jpg" : v))
      .pipe(z.string().refine((v) => v === "best" || ALL_FORMATS.has(v)))
      .optional(),

    /** Output framerate in fps (video only). */
    framerate: zPositiveFloat.optional(),
    /** Limit video duration in seconds (video only). */
    cut: zPositiveFloat.optional(),
    /** Strip audio from video output. */
    mute: zBool.optional(),
    /** Include RFC 6381 codec string in the Content-Type header for video output. */
    codec: zBool.optional(),
    /** Include `Access-Control-Allow-Origin: *` in the response. Required for MSE playback cross-origin. */
    cors: zBool.optional(),

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

    /** Pixelate with given block size in pixels. */
    pixelate: z.coerce.number().int().positive().optional(),

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

    /** Unsharp masking. Format: `<mode>:<weight>:<divider>`. */
    unsharp_masking: z
      .string()
      .transform((v) => {
        const [mode, weight, divider] = v.split(":");
        return {
          mode: mode || "auto",
          weight: weight ? parseFloat(weight) : 1,
          divider: divider ? parseFloat(divider) : 24,
        };
      })
      .optional(),

    blur_areas: notImplemented("blur_areas").optional(),
    blur_detections: notImplemented("blur_detections").optional(),
    draw_detections: notImplemented("draw_detections").optional(),

    /** Colour overlay. Format: `<opacity>[:<hex_colour>[:<keep_alpha>]]`. */
    colorize: z
      .string()
      .transform((v) => {
        const [opacity, colour, keepAlpha] = v.split(":");
        return {
          opacity: parseFloat(opacity) || 0,
          colour: colour || "000",
          keepAlpha:
            keepAlpha === "1" || keepAlpha === "t" || keepAlpha === "true",
        };
      })
      .optional(),

    /** Gradient overlay. Format: `<opacity>[:<colour>[:<direction>[:<start>[:<stop>]]]]`. */
    gradient: z
      .string()
      .transform((v) => {
        const [opacity, colour, direction, start, stop] = v.split(":");
        return {
          opacity: parseFloat(opacity) || 0,
          colour: colour || "000",
          direction: direction || "down",
          start: start ? parseFloat(start) : 0,
          stop: stop ? parseFloat(stop) : 1,
        };
      })
      .optional(),

    /** Watermark overlay. Format: `<opacity>[:<position>[:<x_offset>[:<y_offset>[:<scale>]]]]`. */
    watermark: notImplemented("watermark").optional(),
    /** Custom watermark image URL (base64-encoded). */
    watermark_url: notImplemented("watermark_url").optional(),
    /** Watermark text (base64-encoded, supports Pango markup). */
    watermark_text: notImplemented("watermark_text").optional(),
    /** Watermark dimensions. Format: `<width>:<height>`. */
    watermark_size: notImplemented("watermark_size").optional(),
    /** Watermark rotation in degrees. */
    watermark_rotate: notImplemented("watermark_rotate").optional(),
    /** Watermark shadow blur sigma. */
    watermark_shadow: notImplemented("watermark_shadow").optional(),
    /** Text style (Pango markup). */
    style: notImplemented("style").optional(),

    /** Set output DPI metadata. */
    dpi: z.coerce.number().positive().optional(),
    /** Prefer embedded thumbnail over full image (HEIC/AVIF). */
    enforce_thumbnail: zBool.optional(),

    /** Per-format quality. Format: `<fmt1>:<q1>:<fmt2>:<q2>:...`. */
    format_quality: z
      .string()
      .transform((v) => {
        const parts = v.split(":");
        const result: Record<string, number> = {};
        for (let i = 0; i < parts.length - 1; i += 2) {
          const fmt = parts[i] === "jpeg" ? "jpg" : parts[i];
          result[fmt] = parseInt(parts[i + 1], 10);
        }
        return result;
      })
      .optional(),
    /** Autoquality. Format: `<method>:<target>:<min>:<max>:<allowed_error>`. Methods: dssim, size. */
    autoquality: z
      .string()
      .transform((v) => {
        const [method, target, min, max, err] = v.split(":");
        const m = method || "dssim";
        if (m !== "dssim" && m !== "size") {
          throw new HTTPError(
            `Autoquality method '${m}' is not implemented — supported: dssim, size`,
            { code: "NOT_IMPLEMENTED" },
          );
        }
        return {
          method: m as "dssim" | "size",
          target: target ? parseFloat(target) : m === "size" ? 0 : 0.02,
          min: min ? parseInt(min, 10) : 70,
          max: max ? parseInt(max, 10) : 80,
          allowedError: err ? parseFloat(err) : 0.001,
        };
      })
      .optional(),
    /** Max output size in bytes — degrades quality until under limit. */
    max_bytes: z.coerce.number().int().positive().optional(),

    /** JPEG options. Format: `<progressive>:<no_subsample>:<trellis_quant>:<overshoot_deringing>:<optimize_scans>:<quant_table>`. */
    jpeg_options: z
      .string()
      .transform((v) => {
        const [
          progressive,
          noSubsample,
          trellisQuant,
          overshootDeringing,
          optimizeScans,
          quantTable,
        ] = v.split(":");
        return {
          progressive:
            progressive === "1" ||
            progressive === "t" ||
            progressive === "true",
          noSubsample:
            noSubsample === "1" ||
            noSubsample === "t" ||
            noSubsample === "true",
          trellisQuant:
            trellisQuant === "1" ||
            trellisQuant === "t" ||
            trellisQuant === "true",
          overshootDeringing:
            overshootDeringing === "1" ||
            overshootDeringing === "t" ||
            overshootDeringing === "true",
          optimizeScans:
            optimizeScans === "1" ||
            optimizeScans === "t" ||
            optimizeScans === "true",
          quantTable: quantTable ? parseInt(quantTable, 10) : undefined,
        };
      })
      .optional(),
    /** PNG options. Format: `<interlaced>:<quantize>:<quantization_colours>`. */
    png_options: z
      .string()
      .transform((v) => {
        const [interlaced, quantize, colours] = v.split(":");
        return {
          interlaced:
            interlaced === "1" || interlaced === "t" || interlaced === "true",
          quantize: quantize === "1" || quantize === "t" || quantize === "true",
          quantizationColours: colours ? parseInt(colours, 10) : undefined,
        };
      })
      .optional(),
    /** WebP options. Format: `<compression>:<smart_subsample>:<preset>`. */
    webp_options: z
      .string()
      .transform((v) => {
        const [compression, smartSubsample, preset] = v.split(":");
        return {
          compression: compression ? parseInt(compression, 10) : undefined,
          smartSubsample:
            smartSubsample === "1" ||
            smartSubsample === "t" ||
            smartSubsample === "true",
          preset: preset || undefined,
        };
      })
      .optional(),
    /** AVIF options. Format: `<subsample>`. */
    avif_options: z
      .string()
      .transform((v) => {
        return { subsample: v || undefined };
      })
      .optional(),

    page: notImplemented("page").optional(),
    pages: notImplemented("pages").optional(),
    disable_animation: notImplemented("disable_animation").optional(),

    /** Extract video frame at given second. */
    video_thumbnail_second: z.coerce.number().optional(),
    /** Use only keyframes for video thumbnails. */
    video_thumbnail_keyframes: zBool.optional(),
    video_thumbnail_tile: notImplemented("video_thumbnail_tile").optional(),
    /** Video animation. Format: `<step>:<delay>:<frames>:<frame_width>:<frame_height>:<extend_frame>:<trim>:<fill>:<focus_x>:<focus_y>`. */
    video_thumbnail_animation: z
      .string()
      .transform((v) => {
        const [
          step,
          delay,
          frames,
          frameWidth,
          frameHeight,
          extendFrame,
          trim,
          fill,
          focusX,
          focusY,
        ] = v.split(":");
        return {
          step: step ? parseFloat(step) : 0,
          delay: delay ? parseInt(delay, 10) : 100,
          frames: frames ? parseInt(frames, 10) : 0,
          frameWidth: frameWidth ? parseInt(frameWidth, 10) : 0,
          frameHeight: frameHeight ? parseInt(frameHeight, 10) : 0,
          extendFrame: extendFrame === "1",
          trim: trim === "1",
          fill: fill === "1",
          focusX: focusX ? parseFloat(focusX) : 0.5,
          focusY: focusY ? parseFloat(focusY) : 0.5,
        };
      })
      .optional(),

    /** Skip processing for listed extensions. Format: `<ext1>:<ext2>:...`. */
    skip_processing: z
      .string()
      .transform((v) => {
        if (!v) return [];
        return v.split(":").map((e) => (e === "jpeg" ? "jpg" : e));
      })
      .optional(),
    /** Return source without any processing. */
    raw: zBool.optional(),
    /** Ignored value used to differentiate CDN cache keys. */
    cache_buster: z.string().optional(),
    /** Unix timestamp after which the URL returns 404. */
    expires: z.coerce.number().int().optional(),
    /** Override the download filename in Content-Disposition. */
    filename: z.string().optional(),
    /** When true, set Content-Disposition: attachment. */
    return_attachment: zBool.optional(),
    preset: notImplemented("preset").optional(),
    /** Fallback image URL (base64url-encoded) served when the source fails to load. */
    fallback_image_url: z.string().optional(),
    /** Expected hex-encoded checksum of the source image. Format: `<type>:<hex_digest>`. */
    hashsum: z
      .string()
      .transform((v) => {
        const idx = v.indexOf(":");
        if (idx === -1) {
          throw new HTTPError("hashsum requires format <type>:<hex_digest>", {
            code: "BAD_REQUEST",
          });
        }
        const type = v.slice(0, idx);
        const hash = v.slice(idx + 1);
        return { type, hash };
      })
      .optional(),

    /** Max source resolution in megapixels. */
    max_src_resolution: z.coerce.number().positive().optional(),
    /** Max source file size in bytes. */
    max_src_file_size: z.coerce.number().int().positive().optional(),
    /** Max animation frames. */
    max_animation_frames: z.coerce.number().int().positive().optional(),
    /** Max animation frame resolution in megapixels. */
    max_animation_frame_resolution: z.coerce.number().positive().optional(),
    /** Max result width or height in pixels. */
    max_result_dimension: z.coerce.number().int().positive().optional(),

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

  if (data.extend_aspect_ratio?.enabled && !resize) {
    throw new HTTPError(
      "extend_aspect_ratio requires resize dimensions to derive the target aspect ratio",
      { code: "BAD_REQUEST" },
    );
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
    mute: data.mute,
    codec: data.codec,
    cors: data.cors,
    trim: data.trim,
    brightness: data.brightness ?? data.adjust?.brightness ?? 0,
    contrast: data.contrast ?? data.adjust?.contrast ?? 1,
    saturation: data.saturation ?? data.adjust?.saturation ?? 1,
    monochrome: data.monochrome,
    duotone: data.duotone,
    quality: data.quality,
    formatQuality: data.format_quality,
    autoquality: data.autoquality,
    maxBytes: data.max_bytes,
    jpegOptions: data.jpeg_options,
    pngOptions: data.png_options,
    webpOptions: data.webp_options,
    avifOptions: data.avif_options,
    blur: data.blur,
    sharpen: data.sharpen,
    pixelate: data.pixelate,
    unsharpMasking: data.unsharp_masking,
    colorize: data.colorize,
    gradient: data.gradient,
    rotate: data.rotate,
    flip: data.flip,
    autoRotate: data.auto_rotate,
    background: data.background,
    backgroundAlpha: data.background_alpha,
    padding,
    stripMetadata: data.strip_metadata,
    dpi: data.dpi,
    enforceThumbnail: data.enforce_thumbnail,
    videoThumbnailSecond: data.video_thumbnail_second,
    videoThumbnailKeyframes: data.video_thumbnail_keyframes,
    videoThumbnailAnimation: data.video_thumbnail_animation,
    keepCopyright: data.keep_copyright,
    stripColorProfile: data.strip_color_profile,
    crop: data.crop,
    cropAspectRatio: data.crop_aspect_ratio,
    gravity: data.gravity,
    skipProcessing: data.skip_processing,
    raw: data.raw,
    cacheBuster: data.cache_buster,
    expires: data.expires,
    filename: data.filename,
    returnAttachment: data.return_attachment,
    fallbackImageUrl: data.fallback_image_url,
    hashsum: data.hashsum,
    maxSrcResolution: data.max_src_resolution,
    maxSrcFileSize: data.max_src_file_size,
    maxAnimationFrames: data.max_animation_frames,
    maxAnimationFrameResolution: data.max_animation_frame_resolution,
    maxResultDimension: data.max_result_dimension,
    enlarge: data.enlarge,
    bestFormat: data.format === "best" ? true : undefined,
    formatOverride:
      data.format && data.format !== "best"
        ? (data.format as OutputFormat)
        : undefined,
  };
});

/** All processing options for an asset-proxy URL. Defined as an explicit interface so JSDoc is preserved in declaration output. */
export interface ParsedUrlInput {
  /** Resize dimensions and mode (fit, fill, fill-down, force, auto). */
  resize?: ResizeOptions;
  /** Scaling algorithm — CPU interpolation (e.g. lanczos3) or GPU scaler (scale_cuda, scale_npp). */
  resizingAlgorithm?: ResizingAlgorithm;
  /** The source image/video URL to process. */
  sourceUrl: string;
  /** Output format: jpg, png, webp, avif, gif, mp4, webm. */
  outputFormat: OutputFormat;
  /** Minimum output width — upscales if the result would be narrower. */
  minWidth?: number;
  /** Minimum output height — upscales if the result would be shorter. */
  minHeight?: number;
  /** Pad undersized images to fill the target resize dimensions. */
  extend?: { enabled: boolean; gravity: CompassGravity };
  /** Extend the image to match the target aspect ratio. */
  extendAspectRatio?: { enabled: boolean; gravity: CompassGravity };
  /** Output framerate in fps (video only). */
  framerate?: number;
  /** Limit output duration in seconds (video only). */
  cut?: number;
  /** Strip audio from video output. */
  mute?: boolean;
  /** Include RFC 6381 codec string in the Content-Type header for video output. */
  codec?: boolean;
  /** Include `Access-Control-Allow-Origin: *` in the response. Required for MSE playback cross-origin. */
  cors?: boolean;
  /** Remove uniform borders from an image via cropdetect. */
  trim?: {
    /** Colour similarity tolerance (0–255). */
    threshold: number;
    /** Hex colour to trim. Auto-detected if omitted. */
    colour?: string;
    /** Trim equal amounts from left and right. */
    equalHor: boolean;
    /** Trim equal amounts from top and bottom. */
    equalVert: boolean;
  };
  /** Brightness adjustment (-255 to 255, 0 = no change). */
  brightness: number;
  /** Contrast multiplier (1 = no change). */
  contrast: number;
  /** Saturation multiplier (1 = no change). */
  saturation: number;
  /** Convert to monochrome with optional intensity and base colour. */
  monochrome?: { intensity: number; colour: string };
  /** Apply duotone effect with two colours. */
  duotone?: { intensity: number; colour1: string; colour2: string };
  /** Output quality 1–100 for lossy formats (JPEG, WebP, AVIF). */
  quality?: number;
  /** Per-format quality overrides: { jpg: 80, webp: 90, ... }. */
  formatQuality?: Record<string, number>;
  /** Autoquality: dssim (target DSSIM) or size (target bytes). */
  autoquality?: {
    method: "dssim" | "size";
    target: number;
    min: number;
    max: number;
    allowedError: number;
  };
  /** Max output size in bytes — degrades quality to fit. */
  maxBytes?: number;
  /** JPEG encoder options. */
  jpegOptions?: {
    progressive: boolean;
    noSubsample: boolean;
    trellisQuant: boolean;
    overshootDeringing: boolean;
    optimizeScans: boolean;
    quantTable?: number;
  };
  /** PNG encoder options. */
  pngOptions?: {
    interlaced: boolean;
    quantize: boolean;
    quantizationColours?: number;
  };
  /** WebP encoder options. */
  webpOptions?: {
    compression?: number;
    smartSubsample: boolean;
    preset?: string;
  };
  /** AVIF encoder options. */
  avifOptions?: { subsample?: string };
  /** Gaussian blur sigma. */
  blur?: number;
  /** Sharpening sigma. */
  sharpen?: number;
  /** Pixelate block size in pixels. */
  pixelate?: number;
  /** Unsharp masking: mode (auto/always/none), weight, divider. */
  unsharpMasking?: { mode: string; weight: number; divider: number };
  /** Colour overlay with opacity. */
  colorize?: { opacity: number; colour: string; keepAlpha: boolean };
  /** Gradient overlay from transparent to colour. */
  gradient?: {
    opacity: number;
    colour: string;
    direction: string;
    start: number;
    stop: number;
  };
  /** Rotation angle: 0, 90, 180, or 270 degrees. */
  rotate?: number;
  /** Flip the image horizontally and/or vertically. */
  flip?: { horizontal: boolean; vertical: boolean };
  /** Rotate based on EXIF orientation data. */
  autoRotate?: boolean;
  /** Background colour (RGB) for padding, extend, and alpha flattening. */
  background?: { r: number; g: number; b: number };
  /** Background opacity (0–1). */
  backgroundAlpha?: number;
  /** Canvas padding in pixels: top, right, bottom, left. */
  padding?: { top: number; right: number; bottom: number; left: number };
  /** Remove EXIF and other metadata from the output. */
  stripMetadata?: boolean;
  /** Preserve copyright metadata when stripping. */
  keepCopyright?: boolean;
  /** Convert ICC colour profile to sRGB and remove it. */
  stripColorProfile?: boolean;
  /** Output DPI metadata value. */
  dpi?: number;
  /** Prefer embedded thumbnail over full image (HEIC/AVIF). */
  enforceThumbnail?: boolean;
  /** Extract video frame at this second. */
  videoThumbnailSecond?: number;
  /** Use only keyframes for video thumbnails. */
  videoThumbnailKeyframes?: boolean;
  /** Video animation config. */
  videoThumbnailAnimation?: {
    /** Interval in seconds between sampled video frames (0 = auto). */
    step: number;
    /** Delay between animation frames in milliseconds. */
    delay: number;
    /** Maximum number of output frames (0 = unlimited). */
    frames: number;
    /** Target frame width in pixels (0 = derive from aspect ratio). */
    frameWidth: number;
    /** Target frame height in pixels (0 = derive from aspect ratio). */
    frameHeight: number;
    /** Pad frames with black to match exact frameWidth/frameHeight. */
    extendFrame: boolean;
    /** Remove unused frames from the animation. */
    trim: boolean;
    /** Crop-fill to exact frameWidth/frameHeight instead of fitting. */
    fill: boolean;
    /** Horizontal crop anchor for fill mode (0–1, default 0.5). */
    focusX: number;
    /** Vertical crop anchor for fill mode (0–1, default 0.5). */
    focusY: number;
  };
  /** Extract a region before resizing (width, height, optional gravity). */
  crop?: { width: number; height: number; gravity?: Gravity };
  /** Crop to a target aspect ratio (width/height as a float). */
  cropAspectRatio?: number;
  /** Anchor point for crop: compass direction or focus point. */
  gravity?: Gravity;
  /** Allow upscaling when the image is smaller than the target. */
  enlarge?: boolean;
  /** Automatically select the most efficient output format. */
  bestFormat?: boolean;
  /** Skip processing when the source extension matches one of these formats. */
  skipProcessing?: string[];
  /** Return the source without any processing. */
  raw?: boolean;
  /** Ignored cache-busting value. */
  cacheBuster?: string;
  /** Unix timestamp after which the URL returns 404. */
  expires?: number;
  /** Override the download filename in Content-Disposition. */
  filename?: string;
  /** When true, set Content-Disposition: attachment. */
  returnAttachment?: boolean;
  /** Fallback image URL (base64url-encoded) to serve when the source fails. */
  fallbackImageUrl?: string;
  /** Expected checksum of the source image. */
  hashsum?: { type: string; hash: string };
  /** Max source resolution in megapixels. */
  maxSrcResolution?: number;
  /** Max source file size in bytes. */
  maxSrcFileSize?: number;
  /** Max animation frames. */
  maxAnimationFrames?: number;
  /** Max animation frame resolution in megapixels. */
  maxAnimationFrameResolution?: number;
  /** Max result width or height in pixels. */
  maxResultDimension?: number;
}

/** Zod schema for runtime validation of parsed asset-proxy URL options. The `ParsedUrlInput` interface is the authoritative type definition; this schema validates against it at compile time via `satisfies`. */
export const parsedUrlSchema = z.object({
  resize: resizeOptions.optional(),
  resizingAlgorithm: resizingAlgorithmSchema.optional(),
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
  cut: z.number().optional(),
  mute: z.boolean().optional(),
  codec: z.boolean().optional(),
  cors: z.boolean().optional(),
  trim: z
    .object({
      threshold: z.number(),
      colour: z.string().optional(),
      equalHor: z.boolean(),
      equalVert: z.boolean(),
    })
    .optional(),
  brightness: z.number(),
  contrast: z.number(),
  saturation: z.number(),
  monochrome: z
    .object({ intensity: z.number(), colour: z.string() })
    .optional(),
  duotone: z
    .object({
      intensity: z.number(),
      colour1: z.string(),
      colour2: z.string(),
    })
    .optional(),
  quality: z.number().optional(),
  formatQuality: z.record(z.string(), z.number()).optional(),
  autoquality: z
    .object({
      method: z.enum(["dssim", "size"]),
      target: z.number(),
      min: z.number(),
      max: z.number(),
      allowedError: z.number(),
    })
    .optional(),
  maxBytes: z.number().optional(),
  jpegOptions: z
    .object({
      progressive: z.boolean(),
      noSubsample: z.boolean(),
      trellisQuant: z.boolean(),
      overshootDeringing: z.boolean(),
      optimizeScans: z.boolean(),
      quantTable: z.number().optional(),
    })
    .optional(),
  pngOptions: z
    .object({
      interlaced: z.boolean(),
      quantize: z.boolean(),
      quantizationColours: z.number().optional(),
    })
    .optional(),
  webpOptions: z
    .object({
      compression: z.number().optional(),
      smartSubsample: z.boolean(),
      preset: z.string().optional(),
    })
    .optional(),
  avifOptions: z
    .object({
      subsample: z.string().optional(),
    })
    .optional(),
  blur: z.number().optional(),
  sharpen: z.number().optional(),
  pixelate: z.number().optional(),
  unsharpMasking: z
    .object({ mode: z.string(), weight: z.number(), divider: z.number() })
    .optional(),
  colorize: z
    .object({
      opacity: z.number(),
      colour: z.string(),
      keepAlpha: z.boolean(),
    })
    .optional(),
  gradient: z
    .object({
      opacity: z.number(),
      colour: z.string(),
      direction: z.string(),
      start: z.number(),
      stop: z.number(),
    })
    .optional(),
  rotate: z.number().optional(),
  flip: z.object({ horizontal: z.boolean(), vertical: z.boolean() }).optional(),
  autoRotate: z.boolean().optional(),
  background: rgb.optional(),
  backgroundAlpha: z.number().optional(),
  padding: sides.optional(),
  stripMetadata: z.boolean().optional(),
  keepCopyright: z.boolean().optional(),
  stripColorProfile: z.boolean().optional(),
  dpi: z.number().optional(),
  enforceThumbnail: z.boolean().optional(),
  videoThumbnailSecond: z.number().optional(),
  videoThumbnailKeyframes: z.boolean().optional(),
  videoThumbnailAnimation: z
    .object({
      step: z.number(),
      delay: z.number(),
      frames: z.number(),
      frameWidth: z.number(),
      frameHeight: z.number(),
      extendFrame: z.boolean(),
      trim: z.boolean(),
      fill: z.boolean(),
      focusX: z.number(),
      focusY: z.number(),
    })
    .optional(),
  crop: z
    .object({
      width: z.number(),
      height: z.number(),
      gravity: gravitySchema.optional(),
    })
    .optional(),
  cropAspectRatio: z.number().optional(),
  gravity: gravitySchema.optional(),
  enlarge: z.boolean().optional(),
  bestFormat: z.boolean().optional(),
  skipProcessing: z.array(z.string()).optional(),
  raw: z.boolean().optional(),
  cacheBuster: z.string().optional(),
  expires: z.number().optional(),
  filename: z.string().optional(),
  returnAttachment: z.boolean().optional(),
  fallbackImageUrl: z.string().optional(),
  hashsum: z.object({ type: z.string(), hash: z.string() }).optional(),
  maxSrcResolution: z.number().optional(),
  maxSrcFileSize: z.number().optional(),
  maxAnimationFrames: z.number().optional(),
  maxAnimationFrameResolution: z.number().optional(),
  maxResultDimension: z.number().optional(),
}) satisfies z.ZodType<ParsedUrlInput>;

/** Fully parsed URL with all processing options validated. */
export type ParsedUrl = z.output<typeof parsedUrlSchema> & {
  /** Raw source URL part as it appeared in the request path (e.g. `plain/http://...` or `enc/abc123`), with any `@best` suffix stripped. */
  sourceUrlRaw: string;
};

export type ImageUrl = ParsedUrl & { outputFormat: ImageFormat };
export type VideoUrl = ParsedUrl & { outputFormat: VideoFormat };

/**
 * Classifies a Content-Type header value as image or video. Returns `undefined` for unrecognised types.
 */
export function getMediaType(contentType: string): MediaType | undefined {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  return undefined;
}

/**
 * Determines whether the output of a processing URL will be an image or video, based on the parsed URL options and optionally the source media type (from a Content-Type header).
 *
 * When `sourceMediaType` is provided, it takes precedence over extension-based guessing for ambiguous cases where the output format and processing options don't already determine the result.
 */
export function getOutputMediaType(
  parsed: ParsedUrl,
  sourceMediaType?: MediaType,
): MediaType {
  if (IMAGE_FORMATS.has(parsed.outputFormat)) return "image";
  if (VIDEO_FORMATS.has(parsed.outputFormat)) return "video";
  if (
    parsed.videoThumbnailSecond !== undefined ||
    parsed.videoThumbnailAnimation !== undefined
  )
    return "image";
  if (parsed.framerate !== undefined || parsed.cut !== undefined)
    return "video";
  if (sourceMediaType) return sourceMediaType;
  if (IMAGE_EXTENSIONS.test(parsed.sourceUrl)) return "image";
  return "video";
}

export interface ParseOptions {
  /** AES-256-CBC key for decrypting `/enc/` source URLs. */
  encryptionKey?: Buffer;
}

/**
 * Extracts raw URL options from a signed or unsigned processing URL into a `{ name: value }` record. Shorthand names are expanded to their canonical form. The signature segment (if present) is included as a key with an empty value and can be ignored.
 *
 * Returns `undefined` if the path does not contain `/plain/` or `/enc/`.
 */
export function extractUrlOptions(
  path: string,
): Record<string, string> | undefined {
  const parts = path.split("/");
  const splitIdx = parts.findIndex((p) => /(plain|enc)/.test(p));
  if (splitIdx === -1) return undefined;
  const optionsPart = parts.slice(0, splitIdx);
  return Object.fromEntries(
    optionsPart.filter(Boolean).map((segment) => {
      const idx = segment.indexOf(":");
      if (idx === -1) return [segment, ""];
      const name = segment.slice(0, idx);
      const value = segment.slice(idx + 1);
      return [SHORTHANDS[name] ?? name, value];
    }),
  );
}

/** Parses an imgproxy-format processing path (after signature has been stripped). Supports `/<options>/plain/<source_url>[@<format>]` and `/<options>/enc/<encrypted_source_url>[@<format>]`. */
export function parseProcessingUrl(
  path: string,
  options?: ParseOptions,
): ParsedUrl {
  const parts = path.split("/");
  const splitIdx = parts.findIndex((p) => /(plain|enc)/.test(p));
  if (splitIdx === -1) {
    throw new HTTPError(
      "Unsupported URL format: expected /plain/ or /enc/ source URL",
      { code: "BAD_REQUEST" },
    );
  }
  const encrypted = parts[splitIdx] === "enc";
  let sourceUrl = parts.slice(splitIdx + 1).join("/");
  let sourceUrlRaw = parts.slice(splitIdx).join("/");

  if (!sourceUrl) {
    throw new HTTPError("Missing source URL", { code: "BAD_REQUEST" });
  }

  // Parse @format suffix from source URL
  let format: OutputFormat = "mp4";
  let hasFormatSuffix = false;
  let bestFormatSuffix = false;
  const formatMatch = sourceUrl.match(/@([a-z0-9]+)$/);
  if (formatMatch) {
    let fmt = formatMatch[1];
    if (fmt === "jpeg") fmt = "jpg";
    if (fmt === "best") {
      bestFormatSuffix = true;
      sourceUrl = sourceUrl.slice(0, -formatMatch[0].length);
      sourceUrlRaw = sourceUrlRaw.slice(0, -formatMatch[0].length);
    } else if (ALL_FORMATS.has(fmt)) {
      format = fmt as OutputFormat;
      sourceUrl = sourceUrl.slice(0, -formatMatch[0].length);
      sourceUrlRaw = sourceUrlRaw.slice(0, -formatMatch[0].length);
      hasFormatSuffix = true;
    }
  }

  if (encrypted) {
    if (!options?.encryptionKey) {
      throw new HTTPError(
        "Encrypted source URLs are not supported: no encryption key provided",
        { code: "BAD_REQUEST" },
      );
    }
    sourceUrl = decryptSourceUrl(sourceUrl, options.encryptionKey);
  }

  const raw = extractUrlOptions(path)!;

  const parsedOptions = optionsSchema.parse(raw);

  if (parsedOptions.formatOverride && hasFormatSuffix) {
    throw new HTTPError(
      `Cannot specify both format option (f:${parsedOptions.formatOverride}) and format suffix (@${format})`,
      { code: "BAD_REQUEST" },
    );
  }

  if (parsedOptions.formatOverride) {
    format = parsedOptions.formatOverride;
  }

  if (!hasFormatSuffix && !parsedOptions.formatOverride) {
    if (IMAGE_EXTENSIONS.test(sourceUrl)) {
      format = "jpg";
    }
    // Video thumbnail options produce an image — default to jpg if no explicit image format
    if (
      (parsedOptions.videoThumbnailSecond !== undefined ||
        parsedOptions.videoThumbnailAnimation !== undefined) &&
      VIDEO_FORMATS.has(format)
    ) {
      format = "jpg";
    }
  }

  // best format for video always resolves to mp4: WebM/AV1 has better
  // compression but Apple devices lack reliable WebM playback support.
  if (
    (parsedOptions.bestFormat || bestFormatSuffix) &&
    VIDEO_FORMATS.has(format)
  ) {
    format = "mp4";
  }

  const parsed = parsedUrlSchema.parse({
    resize: parsedOptions.resize,
    resizingAlgorithm: parsedOptions.resizingAlgorithm,
    sourceUrl,
    outputFormat: format,
    minWidth: parsedOptions.minWidth,
    minHeight: parsedOptions.minHeight,
    extend: parsedOptions.extend,
    extendAspectRatio: parsedOptions.extendAspectRatio,
    framerate: parsedOptions.framerate,
    cut: parsedOptions.cut,
    mute: parsedOptions.mute,
    codec: parsedOptions.codec,
    cors: parsedOptions.cors,
    trim: parsedOptions.trim,
    brightness: parsedOptions.brightness,
    contrast: parsedOptions.contrast,
    saturation: parsedOptions.saturation,
    monochrome: parsedOptions.monochrome,
    duotone: parsedOptions.duotone,
    quality: parsedOptions.quality,
    formatQuality: parsedOptions.formatQuality,
    autoquality: parsedOptions.autoquality,
    maxBytes: parsedOptions.maxBytes,
    jpegOptions: parsedOptions.jpegOptions,
    pngOptions: parsedOptions.pngOptions,
    webpOptions: parsedOptions.webpOptions,
    avifOptions: parsedOptions.avifOptions,
    blur: parsedOptions.blur,
    sharpen: parsedOptions.sharpen,
    pixelate: parsedOptions.pixelate,
    unsharpMasking: parsedOptions.unsharpMasking,
    colorize: parsedOptions.colorize,
    gradient: parsedOptions.gradient,
    rotate: parsedOptions.rotate,
    flip: parsedOptions.flip,
    autoRotate: parsedOptions.autoRotate,
    background: parsedOptions.background,
    backgroundAlpha: parsedOptions.backgroundAlpha,
    padding: parsedOptions.padding,
    stripMetadata: parsedOptions.stripMetadata,
    keepCopyright: parsedOptions.keepCopyright,
    stripColorProfile: parsedOptions.stripColorProfile,
    dpi: parsedOptions.dpi,
    enforceThumbnail: parsedOptions.enforceThumbnail,
    videoThumbnailSecond: parsedOptions.videoThumbnailSecond,
    videoThumbnailKeyframes: parsedOptions.videoThumbnailKeyframes,
    videoThumbnailAnimation: parsedOptions.videoThumbnailAnimation,
    crop: parsedOptions.crop,
    cropAspectRatio: parsedOptions.cropAspectRatio,
    gravity: parsedOptions.gravity,
    enlarge: parsedOptions.enlarge,
    bestFormat: parsedOptions.bestFormat || bestFormatSuffix || undefined,
    skipProcessing: parsedOptions.skipProcessing,
    raw: parsedOptions.raw,
    cacheBuster: parsedOptions.cacheBuster,
    expires: parsedOptions.expires,
    filename: parsedOptions.filename,
    returnAttachment: parsedOptions.returnAttachment,
    fallbackImageUrl: parsedOptions.fallbackImageUrl,
    hashsum: parsedOptions.hashsum,
    maxSrcResolution: parsedOptions.maxSrcResolution,
    maxSrcFileSize: parsedOptions.maxSrcFileSize,
    maxAnimationFrames: parsedOptions.maxAnimationFrames,
    maxAnimationFrameResolution: parsedOptions.maxAnimationFrameResolution,
    maxResultDimension: parsedOptions.maxResultDimension,
  });

  return { ...parsed, sourceUrlRaw };
}
