import { Storage } from "@google-cloud/storage";
import express from "express";
import { env } from "./env.js";
import { gpuReady, resizeVideo } from "./ffmpeg.js";
import { logger } from "./logger.js";
import { processImage } from "./sharp.js";
import { verifySignature } from "./signature.js";
import { isImageUrl, parseProcessingUrl } from "./url-parser.js";

const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
};

const gcs = new Storage();

export const app = express();

function assertOriginAllowed(sourceUrl: string): void {
  const { ALLOWED_ORIGINS } = env;
  if (!ALLOWED_ORIGINS) return;

  const origin = extractOrigin(sourceUrl);
  if (!ALLOWED_ORIGINS.has(origin)) {
    throw new Error(`Origin not allowed: ${origin}`);
  }
}

function extractOrigin(sourceUrl: string): string {
  if (sourceUrl.startsWith("gs://")) {
    const bucket = sourceUrl.slice("gs://".length).split("/")[0];
    return `gs://${bucket}`;
  }
  const url = new URL(sourceUrl);
  return url.origin;
}

async function resolveGcsUrl(gsUrl: string): Promise<string> {
  const withoutScheme = gsUrl.slice("gs://".length);
  const slashIdx = withoutScheme.indexOf("/");
  if (slashIdx === -1) {
    throw new Error("Invalid gs:// URL: missing object path");
  }

  const bucket = withoutScheme.slice(0, slashIdx);
  const objectPath = withoutScheme.slice(slashIdx + 1);

  const [signedUrl] = await gcs
    .bucket(bucket)
    .file(objectPath)
    .getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
    });

  return signedUrl;
}

async function handleRequest(req: express.Request, res: express.Response) {
  try {
    const pathAfterSignature = verifySignature(req.path);
    const parsed = parseProcessingUrl(pathAfterSignature);

    assertOriginAllowed(parsed.sourceUrl);

    // Resolve gs:// URLs to signed HTTP URLs
    const sourceUrl = parsed.sourceUrl.startsWith("gs://")
      ? await resolveGcsUrl(parsed.sourceUrl)
      : parsed.sourceUrl;

    if (isImageUrl(parsed)) {
      const buffer = await processImage(sourceUrl, parsed);

      res.set(
        "Content-Type",
        CONTENT_TYPES[parsed.outputFormat] || "image/jpeg",
      );
      res.set("Cache-Control", env.CACHE_CONTROL);
      res.send(buffer);
    } else {
      if (!parsed.resize) {
        throw new Error("Resize options are required for video processing");
      }

      const result = await resizeVideo(sourceUrl, {
        resizingType: parsed.resize.type,
        width: parsed.resize.width,
        height: parsed.resize.height,
        framerate: parsed.framerate,
        trim: parsed.trim,
        outputFormat: parsed.outputFormat,
      });

      res.set(
        "Content-Type",
        CONTENT_TYPES[parsed.outputFormat] || "video/mp4",
      );
      res.set("Cache-Control", env.CACHE_CONTROL);
      result.pipe(res);

      result.on("error", (err) => {
        logger.error("ffmpeg stream error", { error: err.message });
        if (!res.headersSent) {
          res.status(500).send("Processing failed");
        }
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message === "Invalid signature" ? 403 : 400;
    logger.error("Request error", { error: message, status });
    if (!res.headersSent) {
      res.status(status).send(message);
    }
  }
}

app.get("/insecure/{*rest}", handleRequest);
app.get("/{signature}/{*rest}", handleRequest);

app.get("/health", (_req, res) => {
  res.send("ok");
});

async function start() {
  await gpuReady;
  app.listen(env.PORT, () => {
    logger.info(`asset-proxy listening on :${env.PORT}`);
  });
}

start();
