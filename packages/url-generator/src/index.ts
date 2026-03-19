import {
  encryptSourceUrl,
  sign,
  SHORTHANDS,
  type ParsedUrlInput,
} from "@socialtip/asset-proxy-url-parser";

export type { ParsedUrlInput } from "@socialtip/asset-proxy-url-parser";

/** Options for generating a URL, derived from the asset-proxy parsed URL schema. All fields except `sourceUrl` are optional. */
export type UrlGeneratorOptions = Partial<ParsedUrlInput> & {
  sourceUrl: string;
};

/** Configuration for URL encryption and signing. */
export interface UrlGeneratorConfig {
  /** Hex-encoded 32-byte AES-256-CBC key for encrypting the source URL. When set, the source URL is encrypted and the `/enc/` prefix is used. */
  encryptionKey?: string;
  /** When true (and `encryptionKey` is set), derives the encryption IV from the source URL instead of using random bytes. This makes the generated URL deterministic for the same input, which is useful when URLs need to be stable for caching purposes. */
  deterministicEncryption?: boolean;
  /** Hex-encoded HMAC-SHA256 key for URL signing. Must be set together with `signingSalt`. */
  signingKey?: string;
  /** Hex-encoded salt prepended to the path before HMAC signing. Must be set together with `signingKey`. */
  signingSalt?: string;
}

/** Generates an asset-proxy-compatible URL path. */
export function generateUrl(
  options: UrlGeneratorOptions,
  config?: UrlGeneratorConfig,
): string {
  const segments = serializeOptions(options);
  segments.sort((a, b) => {
    const keyA = SHORTHANDS[a.slice(0, a.indexOf(":"))] ?? a;
    const keyB = SHORTHANDS[b.slice(0, b.indexOf(":"))] ?? b;
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  let sourceUrlPart: string;
  if (config?.encryptionKey) {
    const key = Buffer.from(config.encryptionKey, "hex");
    sourceUrlPart = `enc/${encryptSourceUrl(options.sourceUrl, key, { deterministic: config.deterministicEncryption })}`;
  } else {
    sourceUrlPart = `plain/${options.sourceUrl}`;
  }

  const optionsPath = segments.length > 0 ? segments.join("/") + "/" : "";
  const pathAfterSignature = `/${optionsPath}${sourceUrlPart}`;

  let signature = "insecure";
  if (config?.signingKey && config?.signingSalt) {
    signature = sign(
      pathAfterSignature,
      Buffer.from(config.signingKey, "hex"),
      Buffer.from(config.signingSalt, "hex"),
    );
  }

  return `/${signature}${pathAfterSignature}`;
}

function bool(v: boolean): string {
  return v ? "1" : "0";
}

type Gravity = ParsedUrlInput["gravity"];

function serializeGravity(g: NonNullable<Gravity>): string {
  if (typeof g === "string") return g;
  return `fp:${g.x}:${g.y}`;
}

function serializeOptions(options: UrlGeneratorOptions): string[] {
  const segments: string[] = [];

  if (options.outputFormat) segments.push(`f:${options.outputFormat}`);

  if (options.resize) {
    segments.push(
      `rs:${options.resize.type}:${options.resize.width}:${options.resize.height}`,
    );
  }

  if (options.minWidth !== undefined) segments.push(`mw:${options.minWidth}`);
  if (options.minHeight !== undefined) segments.push(`mh:${options.minHeight}`);
  if (options.enlarge !== undefined)
    segments.push(`el:${bool(options.enlarge)}`);

  if (options.extend) {
    segments.push(
      `ex:${bool(options.extend.enabled)}:${options.extend.gravity}`,
    );
  }
  if (options.extendAspectRatio) {
    segments.push(
      `exar:${bool(options.extendAspectRatio.enabled)}:${options.extendAspectRatio.gravity}`,
    );
  }

  if (options.crop) {
    let s = `c:${options.crop.width}:${options.crop.height}`;
    if (options.crop.gravity) s += `:${serializeGravity(options.crop.gravity)}`;
    segments.push(s);
  }
  if (options.cropAspectRatio !== undefined) {
    segments.push(`car:${options.cropAspectRatio}:1`);
  }
  if (options.gravity) {
    segments.push(`g:${serializeGravity(options.gravity)}`);
  }

  if (options.quality !== undefined) segments.push(`q:${options.quality}`);
  if (options.formatQuality) {
    const parts = Object.entries(options.formatQuality).flatMap(([fmt, q]) => [
      fmt,
      String(q),
    ]);
    segments.push(`fq:${parts.join(":")}`);
  }
  if (options.autoquality) {
    const aq = options.autoquality;
    segments.push(
      `aq:${aq.method}:${aq.target}:${aq.min}:${aq.max}:${aq.allowedError}`,
    );
  }
  if (options.maxBytes !== undefined) segments.push(`mb:${options.maxBytes}`);

  if (options.blur !== undefined) segments.push(`bl:${options.blur}`);
  if (options.sharpen !== undefined) segments.push(`sh:${options.sharpen}`);
  if (options.pixelate !== undefined) segments.push(`px:${options.pixelate}`);

  if (options.unsharpMasking) {
    const u = options.unsharpMasking;
    segments.push(`ush:${u.mode}:${u.weight}:${u.divider}`);
  }

  if (options.brightness !== undefined && options.brightness !== 0) {
    segments.push(`br:${options.brightness}`);
  }
  if (options.contrast !== undefined && options.contrast !== 1) {
    segments.push(`co:${options.contrast}`);
  }
  if (options.saturation !== undefined && options.saturation !== 1) {
    segments.push(`sa:${options.saturation}`);
  }

  if (options.monochrome) {
    segments.push(
      `mc:${options.monochrome.intensity}:${options.monochrome.colour}`,
    );
  }
  if (options.duotone) {
    segments.push(
      `dt:${options.duotone.intensity}:${options.duotone.colour1}:${options.duotone.colour2}`,
    );
  }

  if (options.colorize) {
    const c = options.colorize;
    segments.push(`clrz:${c.opacity}:${c.colour}:${bool(c.keepAlpha)}`);
  }
  if (options.gradient) {
    const g = options.gradient;
    segments.push(
      `grd:${g.opacity}:${g.colour}:${g.direction}:${g.start}:${g.stop}`,
    );
  }

  if (options.rotate !== undefined) segments.push(`rot:${options.rotate}`);
  if (options.flip) {
    segments.push(
      `fl:${bool(options.flip.horizontal)}:${bool(options.flip.vertical)}`,
    );
  }
  if (options.autoRotate !== undefined) {
    segments.push(`ar:${bool(options.autoRotate)}`);
  }

  if (options.background) {
    segments.push(
      `bg:${options.background.r}:${options.background.g}:${options.background.b}`,
    );
  }
  if (options.backgroundAlpha !== undefined) {
    segments.push(`bga:${options.backgroundAlpha}`);
  }
  if (options.padding) {
    const p = options.padding;
    segments.push(`pd:${p.top}:${p.right}:${p.bottom}:${p.left}`);
  }

  if (options.stripMetadata !== undefined) {
    segments.push(`sm:${bool(options.stripMetadata)}`);
  }
  if (options.keepCopyright !== undefined) {
    segments.push(`kcr:${bool(options.keepCopyright)}`);
  }
  if (options.stripColorProfile !== undefined) {
    segments.push(`scp:${bool(options.stripColorProfile)}`);
  }
  if (options.dpi !== undefined) segments.push(`dpi:${options.dpi}`);
  if (options.enforceThumbnail !== undefined) {
    segments.push(`eth:${bool(options.enforceThumbnail)}`);
  }

  if (options.framerate !== undefined) segments.push(`fr:${options.framerate}`);
  if (options.cut !== undefined) segments.push(`ct:${options.cut}`);

  if (options.trim) {
    const parts = [String(options.trim.threshold)];
    if (
      options.trim.colour !== undefined ||
      options.trim.equalHor ||
      options.trim.equalVert
    ) {
      parts.push(options.trim.colour ?? "");
    }
    if (options.trim.equalHor || options.trim.equalVert) {
      parts.push(bool(options.trim.equalHor), bool(options.trim.equalVert));
    }
    segments.push(`tr:${parts.join(":")}`);
  }

  if (options.videoThumbnailSecond !== undefined) {
    segments.push(`vts:${options.videoThumbnailSecond}`);
  }
  if (options.videoThumbnailKeyframes !== undefined) {
    segments.push(`vtk:${bool(options.videoThumbnailKeyframes)}`);
  }
  if (options.videoThumbnailAnimation) {
    const v = options.videoThumbnailAnimation;
    segments.push(
      `vta:${v.step}:${v.delay}:${v.frames}:${v.frameWidth}:${v.frameHeight}`,
    );
  }

  if (options.jpegOptions) {
    const j = options.jpegOptions;
    let s = `jpgo:${bool(j.progressive)}:${bool(j.noSubsample)}:${bool(j.trellisQuant)}:${bool(j.overshootDeringing)}:${bool(j.optimizeScans)}`;
    if (j.quantTable !== undefined) s += `:${j.quantTable}`;
    segments.push(s);
  }
  if (options.pngOptions) {
    const p = options.pngOptions;
    let s = `pngo:${bool(p.interlaced)}:${bool(p.quantize)}`;
    if (p.quantizationColours !== undefined) s += `:${p.quantizationColours}`;
    segments.push(s);
  }
  if (options.webpOptions) {
    const w = options.webpOptions;
    let s = `wpo:${w.compression ?? ""}:${bool(w.smartSubsample)}`;
    if (w.preset) s += `:${w.preset}`;
    segments.push(s);
  }
  if (options.avifOptions?.subsample) {
    segments.push(`avo:${options.avifOptions.subsample}`);
  }

  return segments;
}
