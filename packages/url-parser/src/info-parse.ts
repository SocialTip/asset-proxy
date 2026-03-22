import { z } from "zod/v4";

const zBool = z
  .string()
  .transform((v) => v === "1" || v === "t" || v === "true");

const INFO_SHORTHANDS: Record<string, string> = {
  cs: "colorspace",
  b: "bands",
  sf: "sample_format",
  pn: "pages_number",
  a: "alpha",
  p: "palette",
  avg: "average",
  dc: "dominant_colors",
};

const rawInfoOptionsSchema = z.object({
  exif: zBool.optional(),
  iptc: zBool.optional(),
  xmp: zBool.optional(),
  colorspace: zBool.optional(),
  bands: zBool.optional(),
  sample_format: zBool.optional(),
  pages_number: zBool.optional(),
  alpha: zBool.optional(),
  palette: z.coerce.number().int().min(0).max(256).optional(),
  average: z
    .string()
    .transform((v) => {
      const parts = v.split(":");
      const enabled =
        parts[0] === "1" || parts[0] === "t" || parts[0] === "true";
      const ignoreTransparent =
        parts[1] === "1" || parts[1] === "t" || parts[1] === "true";
      return enabled ? { ignoreTransparent } : undefined;
    })
    .optional(),
  dominant_colors: zBool.optional(),
});

const infoOptionsSchema = rawInfoOptionsSchema.transform((data) => ({
  exif: data.exif,
  iptc: data.iptc,
  xmp: data.xmp,
  colorspace: data.colorspace,
  bands: data.bands,
  sampleFormat: data.sample_format,
  pagesNumber: data.pages_number,
  alpha: data.alpha,
  palette: data.palette,
  average: data.average,
  dominantColors: data.dominant_colors,
}));

/** Parsed info endpoint options that control which additional metadata is returned. */
export interface InfoOptions {
  /** Include EXIF metadata in the response. */
  exif?: boolean;
  /** Include IPTC metadata in the response. */
  iptc?: boolean;
  /** Include XMP metadata organised by namespace in the response. */
  xmp?: boolean;
  /** Include the image colour space (e.g. `gbr`, `bt709`). */
  colorspace?: boolean;
  /** Include the number of image bands/channels. */
  bands?: boolean;
  /** Include the sample format (uchar, ushort, float). */
  sampleFormat?: boolean;
  /** Include the page/frame count. */
  pagesNumber?: boolean;
  /** Include alpha channel information. */
  alpha?: boolean;
  /** Return an RGBA colour palette with this many colours (2-256). 0 or undefined to disable. */
  palette?: number;
  /** Return the average image colour. */
  average?: { ignoreTransparent: boolean };
  /** Return six dominant colour categories (vibrant, muted, light/dark variants). */
  dominantColors?: boolean;
}

/** Zod schema for runtime validation of parsed info options. The `InfoOptions` interface is the authoritative type definition; this schema validates against it at compile time via `satisfies`. */
export const parsedInfoOptionsSchema = z.object({
  exif: z.boolean().optional(),
  iptc: z.boolean().optional(),
  xmp: z.boolean().optional(),
  colorspace: z.boolean().optional(),
  bands: z.boolean().optional(),
  sampleFormat: z.boolean().optional(),
  pagesNumber: z.boolean().optional(),
  alpha: z.boolean().optional(),
  palette: z.number().optional(),
  average: z.object({ ignoreTransparent: z.boolean() }).optional(),
  dominantColors: z.boolean().optional(),
}) satisfies z.ZodType<InfoOptions>;

const INFO_OPTION_NAMES = new Set([
  ...Object.keys(INFO_SHORTHANDS),
  ...Object.values(INFO_SHORTHANDS),
  "exif",
  "iptc",
  "xmp",
]);

/** Extracts info-specific options from a URL path, returning the parsed options and the path with info segments removed. */
export function parseInfoOptions(path: string): {
  infoOptions: InfoOptions;
  cleanedPath: string;
} {
  const segments = path.split("/").filter(Boolean);
  const infoRaw: Record<string, string> = {};
  const kept: string[] = [];

  for (const seg of segments) {
    const colonIdx = seg.indexOf(":");
    const name = colonIdx === -1 ? seg : seg.slice(0, colonIdx);
    const canonical = INFO_SHORTHANDS[name] ?? name;

    if (INFO_OPTION_NAMES.has(name)) {
      infoRaw[canonical] = colonIdx === -1 ? "" : seg.slice(colonIdx + 1);
    } else {
      kept.push(seg);
    }
  }

  const infoOptions = parsedInfoOptionsSchema.parse(
    infoOptionsSchema.parse(infoRaw),
  );
  return { infoOptions, cleanedPath: "/" + kept.join("/") };
}
