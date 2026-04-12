import { z } from "zod/v4";

function parseFormatMap(
  v: string | undefined,
): Record<string, number> | undefined {
  if (!v) return undefined;
  const result: Record<string, number> = {};
  for (const pair of v.split(",")) {
    const [fmt, val] = pair.split("=");
    if (fmt && val) result[fmt.trim()] = parseInt(val.trim(), 10);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

const logLevels = [
  "error",
  "warn",
  "info",
  "verbose",
  "debug",
  "silly",
] as const;

const commonFields = {
  /** Server listen port. */
  PORT: z.coerce.number().int().positive().default(8080),

  /** Optional HTTP/1.1 health-check port. When set, the proxy starts a plain HTTP/1.1 server on this port that responds to GET /health. Useful for load-balancer probes that do not support h2c. */
  HEALTH_PORT: z.coerce.number().int().positive().optional(),

  /** Cache-Control header value for successful responses. */
  CACHE_CONTROL: z.string().default("public, max-age=31536000, immutable"),

  /** Trace sampling rate (0–1). Error traces are always exported regardless of this setting. Defaults to 0.1 (10%). */
  TRACE_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  /** Minimum log level. Defaults to "info". */
  LOG_LEVEL: z.enum(logLevels).default("info"),
};

const processingModeSchema = z
  .object({
    ...commonFields,

    /** Set to any truthy value to skip GPU acceleration and use CPU encoding instead.
     *  When unset, GPU (NVENC) is required and the process will exit if unavailable. */
    SKIP_GPU: z
      .string()
      .optional()
      .transform((v) => !!v),

    /** Maximum number of concurrent GPU (NVENC) ffmpeg processes. Defaults to 1. */
    GPU_CONCURRENCY: z.coerce.number().int().positive().default(1),

    /** Milliseconds to wait for a GPU slot before returning HTTP 429. Defaults to 5000. */
    GPU_ACQUIRE_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),

    /** Hex-encoded HMAC-SHA256 key for verifying URL signatures.
     *  When set, all requests must be signed. */
    SIGNING_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]+$/, "Must be a hex-encoded string")
      .transform((v) => Buffer.from(v, "hex"))
      .optional(),

    /** Hex-encoded salt prepended to the path before HMAC signing.
     *  Required when SIGNING_KEY is set. */
    SIGNING_SALT: z
      .string()
      .regex(/^[0-9a-fA-F]+$/, "Must be a hex-encoded string")
      .transform((v) => Buffer.from(v, "hex"))
      .optional(),

    /** 32-byte hex-encoded AES-256-CBC key for decrypting encrypted source URLs (/enc/ format).
     *  When unset, encrypted source URLs are not supported. */
    SOURCE_URL_ENCRYPTION_KEY: z
      .string()
      .regex(
        /^[0-9a-fA-F]{64}$/,
        "Must be a 32-byte hex-encoded string (64 hex characters)",
      )
      .transform((v) => Buffer.from(v, "hex"))
      .optional(),

    /** Comma-separated list of allowed source URL origins (e.g. "https://example.com,gs://my-bucket").
     *  When unset, all origins are permitted. */
    ALLOWED_ORIGINS: z
      .string()
      .optional()
      .transform((v) =>
        v
          ? new Set(
              v
                .split(",")
                .map((o) => o.trim())
                .filter(Boolean),
            )
          : undefined,
      ),

    /** When true, strip EXIF/IPTC metadata from output images. Defaults to true. */
    STRIP_METADATA: z
      .string()
      .optional()
      .transform((v) => v === undefined || v === "1" || v === "true"),

    /** When true, preserve copyright metadata even when stripping. Defaults to true. */
    KEEP_COPYRIGHT: z
      .string()
      .optional()
      .transform((v) => v === undefined || v === "1" || v === "true"),

    /** When true, convert embedded ICC colour profile to sRGB and remove it. Defaults to true. */
    STRIP_COLOR_PROFILE: z
      .string()
      .optional()
      .transform((v) => v === undefined || v === "1" || v === "true"),

    /** When true, prefer embedded thumbnails over full image for HEIC/AVIF. Defaults to false. */
    ENFORCE_THUMBNAIL: z
      .string()
      .optional()
      .transform((v) => v === "1" || v === "true"),

    /** Default quality for lossy formats (1–100). */
    QUALITY: z.coerce.number().int().min(1).max(100).default(80),
    /** Format-specific default quality, e.g. "avif=63,webp=79". Overrides QUALITY for the specified formats. */
    FORMAT_QUALITY: z
      .string()
      .optional()
      .transform((v) => parseFormatMap(v)),

    /** Autoquality method: none, dssim, or size. ML is not supported. */
    AUTOQUALITY_METHOD: z.enum(["none", "dssim", "size"]).default("none"),
    /** Autoquality target (DSSIM value for dssim, bytes for size). */
    AUTOQUALITY_TARGET: z.coerce.number().optional(),
    /** Autoquality minimum quality. */
    AUTOQUALITY_MIN: z.coerce.number().int().optional(),
    /** Autoquality maximum quality. */
    AUTOQUALITY_MAX: z.coerce.number().int().optional(),
    /** Autoquality allowed DSSIM error. */
    AUTOQUALITY_ALLOWED_ERROR: z.coerce.number().optional(),
    /** Format-specific autoquality min, e.g. "avif=60,webp=70". */
    AUTOQUALITY_FORMAT_MIN: z
      .string()
      .optional()
      .transform((v) => parseFormatMap(v)),
    /** Format-specific autoquality max, e.g. "avif=65,webp=80". */
    AUTOQUALITY_FORMAT_MAX: z
      .string()
      .optional()
      .transform((v) => parseFormatMap(v)),

    /** Complexity threshold for best format selection. Images below this entropy value are considered "simple" and will prefer lossless formats. */
    BEST_FORMAT_COMPLEXITY_THRESHOLD: z.coerce.number().default(5.5),
    /** When > 0, skip best format testing for images exceeding this megapixel count. */
    BEST_FORMAT_MAX_RESOLUTION: z.coerce.number().default(0),
    /** When true, automatically select the best format when no explicit output format is specified. */
    BEST_FORMAT_BY_DEFAULT: z
      .string()
      .optional()
      .transform((v) => v === "1" || v === "true"),

    /** Max source resolution in megapixels. 0 = unlimited. */
    MAX_SRC_RESOLUTION: z.coerce.number().default(0),
    /** Max source file size in bytes. 0 = unlimited. */
    MAX_SRC_FILE_SIZE: z.coerce.number().int().default(0),
    /** Max animation frames. 0 = unlimited. */
    MAX_ANIMATION_FRAMES: z.coerce.number().int().default(0),
    /** Max animation frame resolution in megapixels. 0 = unlimited. */
    MAX_ANIMATION_FRAME_RESOLUTION: z.coerce.number().default(0),
    /** Max result width or height in pixels. 0 = unlimited. */
    MAX_RESULT_DIMENSION: z.coerce.number().int().default(0),
  })
  .refine(
    (data) => {
      const hasKey = data.SIGNING_KEY !== undefined;
      const hasSalt = data.SIGNING_SALT !== undefined;
      return hasKey === hasSalt;
    },
    {
      message: "SIGNING_KEY and SIGNING_SALT must both be set or both be unset",
    },
  );

const cacheModeSchema = z.object({
  ...commonFields,

  /** URL of the processing proxy to forward cache misses to. Supports http:// (h2c) and https:// (h2 over TLS). */
  FORWARD_URL: z.string().url(),

  /** GCS bucket name for the cache. */
  CACHE_BUCKET: z.string(),
});

export type ProcessingEnv = z.infer<typeof processingModeSchema>;
export type CacheEnv = z.infer<typeof cacheModeSchema>;
export type Env = ProcessingEnv | CacheEnv;

function isCacheMode(e: Env): e is CacheEnv {
  return "FORWARD_URL" in e;
}

export const env: Env = process.env.FORWARD_URL
  ? cacheModeSchema.parse(process.env)
  : processingModeSchema.parse(process.env);

export { isCacheMode };
