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
});

export const env = envSchema.parse(process.env);
