import { z } from "zod/v4";

const envSchema = z
  .object({
    /** Server listen port. */
    PORT: z.coerce.number().int().positive().default(8080),

    /** Set to any truthy value to skip GPU acceleration and use CPU encoding instead.
     *  When unset, GPU (NVENC) is required and the process will exit if unavailable. */
    SKIP_GPU: z
      .string()
      .optional()
      .transform((v) => !!v),

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

    /** Cache-Control header value for successful responses. */
    CACHE_CONTROL: z.string().default("public, max-age=31536000, immutable"),
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

export const env = envSchema.parse(process.env);
