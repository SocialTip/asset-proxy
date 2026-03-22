import { z } from "zod/v4";
import { decryptSourceUrl } from "./crypto.js";
import { HTTPError } from "./error.js";

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
  bh: "blurhash",
  chs: "calc_hashsums",
};

const hashsumType = z.enum(["md5", "sha1", "sha256", "sha512"]);

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
  blurhash: data.blurhash,
  calcHashsums: data.calc_hashsums,
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
  /** Return a BlurHash string with the given x and y components. */
  blurhash?: { xComponents: number; yComponents: number };
  /** Calculate and return hashsums of the source file. List of types: md5, sha1, sha256, sha512. */
  calcHashsums?: Array<"md5" | "sha1" | "sha256" | "sha512">;
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
  blurhash: z
    .object({ xComponents: z.number(), yComponents: z.number() })
    .optional(),
  calcHashsums: z.array(hashsumType).optional(),
}) satisfies z.ZodType<InfoOptions>;

const CONTROL_SHORTHANDS: Record<string, string> = {
  exp: "expires",
  hs: "hashsum",
  msfs: "max_src_file_size",
  cb: "cache_buster",
};

const ALL_SHORTHANDS: Record<string, string> = {
  ...INFO_SHORTHANDS,
  ...CONTROL_SHORTHANDS,
};

const ALL_OPTION_NAMES = new Set([
  ...Object.keys(ALL_SHORTHANDS),
  ...Object.values(ALL_SHORTHANDS),
  "exif",
  "iptc",
  "xmp",
]);

/** Parsed result from an info URL. */
export interface ParsedInfoUrl {
  sourceUrl: string;
  infoOptions: InfoOptions;
  expires?: number;
  hashsum?: { type: string; hash: string };
  maxSrcFileSize?: number;
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

  const infoRaw: Record<string, string> = {};
  const controlRaw: Record<string, string> = {};

  for (const seg of optionsPart.split("/").filter(Boolean)) {
    const colonIdx = seg.indexOf(":");
    const name = colonIdx === -1 ? seg : seg.slice(0, colonIdx);
    const value = colonIdx === -1 ? "" : seg.slice(colonIdx + 1);
    const canonical = ALL_SHORTHANDS[name] ?? name;

    if (!ALL_OPTION_NAMES.has(name)) continue;

    if (
      canonical in CONTROL_SHORTHANDS ||
      Object.values(CONTROL_SHORTHANDS).includes(canonical)
    ) {
      controlRaw[canonical] = value;
    } else {
      infoRaw[canonical] = value;
    }
  }

  const infoOptions = parsedInfoOptionsSchema.parse(
    infoOptionsSchema.parse(infoRaw),
  );

  const result: ParsedInfoUrl = { sourceUrl, infoOptions };

  if (controlRaw.expires) {
    result.expires = parseInt(controlRaw.expires, 10);
  }
  if (controlRaw.hashsum) {
    const idx = controlRaw.hashsum.indexOf(":");
    if (idx !== -1) {
      result.hashsum = {
        type: controlRaw.hashsum.slice(0, idx),
        hash: controlRaw.hashsum.slice(idx + 1),
      };
    }
  }
  if (controlRaw.max_src_file_size) {
    result.maxSrcFileSize = parseInt(controlRaw.max_src_file_size, 10);
  }

  return result;
}
