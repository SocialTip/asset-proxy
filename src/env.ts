import { z } from "zod/v4";

const envSchema = z.object({
  /** Server listen port. */
  PORT: z.coerce.number().int().positive().default(8080),

  /** Set to any truthy value to skip GPU acceleration and use CPU encoding instead.
   *  When unset, GPU (NVENC) is required and the process will exit if unavailable. */
  SKIP_GPU: z
    .string()
    .optional()
    .transform((v) => !!v),

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
});

export const env = envSchema.parse(process.env);
