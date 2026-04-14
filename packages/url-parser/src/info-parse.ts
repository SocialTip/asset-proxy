import { z } from "zod/v4";

import { decryptSourceUrl } from "./crypto.js";
import { HTTPError } from "./error.js";

const zBool = z
  .string()
  .transform((v) => v === "1" || v === "t" || v === "true");

const zBoolDefaultTrue = z
  .string()
  .optional()
  .transform(
    (v) => v === undefined || (v !== "0" && v !== "f" && v !== "false"),
  );

const INFO_SHORTHANDS: Record<string, string> = {
  cs: "colorspace",
  b: "bands",
  sf: "sample_format",
  pn: "pages_number",
  a: "alpha",
  p: "palette",
  avg: "average",
  dc: "dominant_colors",
  bh: "blurhash",
  chs: "calc_hashsums",
  pg: "page",
  f: "format",
  d: "dimensions",
  vm: "video_meta",
};

const hashsumType = z.enum(["md5", "sha1", "sha256", "sha512"]);

const rawInfoOptionsSchema = z.object({
  size: zBoolDefaultTrue,
  format: zBoolDefaultTrue,
  dimensions: zBoolDefaultTrue,
  video_meta: zBoolDefaultTrue,
  exif: zBoolDefaultTrue,
  iptc: zBoolDefaultTrue,
  xmp: zBoolDefaultTrue,
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
  blurhash: z
    .string()
    .transform((v) => {
      const [x, y] = v.split(":").map(Number);
      if (!x || !y) return undefined;
      return { xComponents: x, yComponents: y };
    })
    .optional(),
  calc_hashsums: z
    .string()
    .transform((v) =>
      v.split(":").filter((t) => hashsumType.safeParse(t).success),
    )
    .optional(),
  page: z.coerce.number().int().min(0).optional(),
});

const infoOptionsSchema = rawInfoOptionsSchema.transform((data) => ({
  size: data.size,
  format: data.format,
  dimensions: data.dimensions,
  videoMeta: data.video_meta,
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
  blurhash: data.blurhash,
  calcHashsums: data.calc_hashsums,
  page: data.page,
}));

/** Parsed info endpoint options that control which additional metadata is returned. */
export interface InfoOptions {
  /** Include the file size. Defaults to `true`. */
  size: boolean;
  /** Include format and MIME type. Defaults to `true`. */
  format: boolean;
  /** Include width, height, and orientation. Defaults to `true`. */
  dimensions: boolean;
  /** Include video metadata and stream information. Defaults to `true`. */
  videoMeta: boolean;
  /** Include EXIF metadata in the response. Defaults to `true`. */
  exif: boolean;
  /** Include IPTC metadata in the response. Defaults to `true`. */
  iptc: boolean;
  /** Include XMP metadata organised by namespace in the response. Defaults to `true`. */
  xmp: boolean;
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
  /** Return a BlurHash string with the given x and y components. */
  blurhash?: { xComponents: number; yComponents: number };
  /** Calculate and return hashsums of the source file. List of types: md5, sha1, sha256, sha512. */
  calcHashsums?: Array<"md5" | "sha1" | "sha256" | "sha512">;
  /** Which page to analyse for multi-page images (0-indexed). */
  page?: number;
}

/** Zod schema for runtime validation of parsed info options. The `InfoOptions` interface is the authoritative type definition; this schema validates against it at compile time via `satisfies`. */
export const parsedInfoOptionsSchema = z.object({
  size: z.boolean(),
  format: z.boolean(),
  dimensions: z.boolean(),
  videoMeta: z.boolean(),
  exif: z.boolean(),
  iptc: z.boolean(),
  xmp: z.boolean(),
  colorspace: z.boolean().optional(),
  bands: z.boolean().optional(),
  sampleFormat: z.boolean().optional(),
  pagesNumber: z.boolean().optional(),
  alpha: z.boolean().optional(),
  palette: z.number().optional(),
  average: z.object({ ignoreTransparent: z.boolean() }).optional(),
  dominantColors: z.boolean().optional(),
  blurhash: z
    .object({ xComponents: z.number(), yComponents: z.number() })
    .optional(),
  calcHashsums: z.array(hashsumType).optional(),
  page: z.number().optional(),
}) satisfies z.ZodType<InfoOptions>;

const CONTROL_SHORTHANDS: Record<string, string> = {
  exp: "expires",
  hs: "hashsum",
  msfs: "max_src_file_size",
  msr: "max_src_resolution",
  cb: "cache_buster",
};

const ALL_SHORTHANDS: Record<string, string> = {
  ...INFO_SHORTHANDS,
  ...CONTROL_SHORTHANDS,
};

const ALL_OPTION_NAMES = new Set([
  ...Object.keys(ALL_SHORTHANDS),
  ...Object.values(ALL_SHORTHANDS),
  "size",
  "format",
  "dimensions",
  "video_meta",
  "exif",
  "iptc",
  "xmp",
]);

const rawControlOptionsSchema = z.object({
  expires: z.coerce.number().int().optional(),
  hashsum: z
    .string()
    .transform((v) => {
      const idx = v.indexOf(":");
      if (idx === -1) return undefined;
      return { type: v.slice(0, idx), hash: v.slice(idx + 1) };
    })
    .optional(),
  max_src_file_size: z.coerce.number().int().positive().optional(),
  max_src_resolution: z.coerce.number().positive().optional(),
  cache_buster: z.string().optional(),
});

const controlOptionsSchema = rawControlOptionsSchema.transform((data) => ({
  expires: data.expires,
  hashsum: data.hashsum,
  maxSrcFileSize: data.max_src_file_size,
  maxSrcResolution: data.max_src_resolution,
}));

/** Control options parsed from an info URL (security, limits). */
export interface ControlOptions {
  /** Unix timestamp after which the URL returns 404. */
  expires?: number;
  /** Expected checksum of the source file. */
  hashsum?: { type: string; hash: string };
  /** Max source file size in bytes. */
  maxSrcFileSize?: number;
  /** Max source resolution in megapixels. */
  maxSrcResolution?: number;
}

/** Zod schema for runtime validation of parsed control options. The `ControlOptions` interface is the authoritative type definition; this schema validates against it at compile time via `satisfies`. */
export const parsedControlOptionsSchema = z.object({
  expires: z.number().optional(),
  hashsum: z.object({ type: z.string(), hash: z.string() }).optional(),
  maxSrcFileSize: z.number().optional(),
  maxSrcResolution: z.number().optional(),
}) satisfies z.ZodType<ControlOptions>;

/** Parsed result from an info URL. */
export interface ParsedInfoUrl extends ControlOptions {
  sourceUrl: string;
  infoOptions: InfoOptions;
}

export interface InfoParseOptions {
  encryptionKey?: Buffer;
}

/** Parses an info URL path (after signature has been stripped). Extracts the source URL, info options, and control options (expires, hashsum, source limits). */
export function parseInfoUrl(
  path: string,
  options?: InfoParseOptions,
): ParsedInfoUrl {
  const withoutPrefix = path.replace(/^\//, "");

  let optionsPart: string;
  let sourceUrl: string;
  let encrypted = false;

  const plainIdx = withoutPrefix.indexOf("plain/");
  const encIdx = withoutPrefix.indexOf("enc/");

  if (plainIdx !== -1 && (encIdx === -1 || plainIdx <= encIdx)) {
    optionsPart = withoutPrefix.slice(0, plainIdx).replace(/\/$/, "");
    sourceUrl = withoutPrefix.slice(plainIdx + "plain/".length);
  } else if (encIdx !== -1) {
    optionsPart = withoutPrefix.slice(0, encIdx).replace(/\/$/, "");
    sourceUrl = withoutPrefix.slice(encIdx + "enc/".length);
    encrypted = true;
  } else {
    throw new HTTPError(
      "Unsupported URL format: expected /plain/ or /enc/ source URL",
      { code: "BAD_REQUEST" },
    );
  }

  if (!sourceUrl) {
    throw new HTTPError("Missing source URL", { code: "BAD_REQUEST" });
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

  const controlCanonicals = new Set(Object.values(CONTROL_SHORTHANDS));
  const infoRaw: Record<string, string> = {};
  const controlRaw: Record<string, string> = {};

  for (const seg of optionsPart.split("/").filter(Boolean)) {
    const colonIdx = seg.indexOf(":");
    const name = colonIdx === -1 ? seg : seg.slice(0, colonIdx);
    const value = colonIdx === -1 ? "" : seg.slice(colonIdx + 1);
    const canonical = ALL_SHORTHANDS[name] ?? name;

    if (!ALL_OPTION_NAMES.has(name)) continue;

    if (controlCanonicals.has(canonical)) {
      controlRaw[canonical] = value;
    } else {
      infoRaw[canonical] = value;
    }
  }

  const infoOptions = parsedInfoOptionsSchema.parse(
    infoOptionsSchema.parse(infoRaw),
  );
  const control = parsedControlOptionsSchema.parse(
    controlOptionsSchema.parse(controlRaw),
  );

  return { sourceUrl, infoOptions, ...control };
}
