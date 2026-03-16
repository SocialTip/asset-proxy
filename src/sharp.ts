import sharp from "sharp";
import { HTTPError } from "./error.js";
import type {
  Gravity,
  ImageFormat,
  ImageUrl,
  ResizingType,
} from "./url-parser.js";

function mapFit(
  type: ResizingType,
): "inside" | "cover" | "fill" | "outside" | "contain" {
  switch (type) {
    case "fit":
      return "inside";
    case "fill":
    case "fill-down":
    case "auto":
      return "cover";
    case "force":
      return "fill";
    default:
      return "inside";
  }
}

function mapGravity(
  g: Gravity | undefined,
): sharp.Gravity | string | undefined {
  if (!g) return undefined;
  const map: Record<Gravity, string> = {
    no: "north",
    so: "south",
    ea: "east",
    we: "west",
    noea: "northeast",
    nowe: "northwest",
    soea: "southeast",
    sowe: "southwest",
    ce: "centre",
  };
  return map[g];
}

export async function processImage(
  sourceUrl: string,
  parsed: ImageUrl,
): Promise<Buffer> {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new HTTPError(`Failed to fetch source image: ${response.status}`, {
      code: "BAD_GATEWAY",
    });
  }
  const inputBuffer = Buffer.from(await response.arrayBuffer());

  let pipeline = sharp(inputBuffer);
  const outputFormat = parsed.outputFormat;

  // Auto-rotate based on EXIF (default on, unless explicitly disabled)
  if (parsed.autoRotate !== false) {
    pipeline = pipeline.rotate();
  }

  // Explicit rotation (applied after auto-rotate)
  if (parsed.rotate) {
    pipeline = pipeline.rotate(parsed.rotate);
  }

  // Crop (extract region before resize, per imgproxy behaviour)
  if (parsed.crop && (parsed.crop.width > 0 || parsed.crop.height > 0)) {
    const meta = await sharp(inputBuffer).metadata();
    const srcW = meta.width ?? 0;
    const srcH = meta.height ?? 0;

    // Values < 1 are treated as relative to source dimensions
    const cropW =
      parsed.crop.width < 1
        ? Math.round(parsed.crop.width * srcW)
        : Math.round(parsed.crop.width);
    const cropH =
      parsed.crop.height < 1
        ? Math.round(parsed.crop.height * srcH)
        : Math.round(parsed.crop.height);

    const gravity = mapGravity(
      parsed.crop.gravity ?? parsed.gravity ?? "ce",
    ) as sharp.Gravity;

    pipeline = pipeline.resize({
      width: cropW || undefined,
      height: cropH || undefined,
      fit: "cover",
      position: gravity,
    });

    // If there's also a resize, re-pipe from the crop result
    if (parsed.resize) {
      pipeline = sharp(await pipeline.toBuffer());
    }
  }

  // Resize
  if (parsed.resize && (parsed.resize.width > 0 || parsed.resize.height > 0)) {
    const fit = mapFit(parsed.resize.type);
    pipeline = pipeline.resize({
      width: parsed.resize.width || undefined,
      height: parsed.resize.height || undefined,
      fit,
      withoutEnlargement: parsed.resize.type === "fill-down" || !parsed.enlarge,
      position: mapGravity(parsed.gravity) as sharp.Gravity | undefined,
      background: parsed.background
        ? { ...parsed.background, alpha: 1 }
        : undefined,
    });
  }

  // Blur
  if (parsed.blur && parsed.blur > 0) {
    // sharp expects sigma >= 0.3
    pipeline = pipeline.blur(Math.max(parsed.blur, 0.3));
  }

  // Sharpen
  if (parsed.sharpen && parsed.sharpen > 0) {
    pipeline = pipeline.sharpen(parsed.sharpen);
  }

  // Background (flatten alpha onto a solid colour)
  if (parsed.background) {
    pipeline = pipeline.flatten({ background: parsed.background });
  }

  // Padding (extend canvas)
  if (parsed.padding) {
    pipeline = pipeline.extend({
      top: parsed.padding.top,
      bottom: parsed.padding.bottom,
      left: parsed.padding.left,
      right: parsed.padding.right,
      background: parsed.background
        ? { ...parsed.background, alpha: 1 }
        : { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }

  // Strip metadata (sharp strips by default; use withMetadata to preserve)
  if (parsed.stripMetadata === false) {
    pipeline = pipeline.withMetadata();
  }

  // Output format
  pipeline = applyOutputFormat(pipeline, outputFormat, parsed.quality);

  return pipeline.toBuffer();
}

function applyOutputFormat(
  pipeline: sharp.Sharp,
  format: ImageFormat,
  quality?: number,
): sharp.Sharp {
  switch (format) {
    case "jpg":
      return pipeline.jpeg({ quality: quality ?? 80 });
    case "png":
      return pipeline.png({ quality: quality ?? undefined });
    case "webp":
      return pipeline.webp({ quality: quality ?? 80 });
    case "avif":
      return pipeline.avif({ quality: quality ?? 50 });
    case "gif":
      return pipeline.gif();
  }
}
