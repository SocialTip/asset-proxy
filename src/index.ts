import { Storage } from "@google-cloud/storage";
import express from "express";
import { env } from "./env.js";
import { HTTPError } from "./error.js";
import { gpuReady, processImage, processVideo } from "./ffmpeg.js";
import { logger } from "./logger.js";
import { verifySignature } from "./signature.js";
import { isImageUrl, isVideoUrl, parseProcessingUrl } from "./url-parser.js";

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
    throw new HTTPError(`Origin not allowed: ${origin}`, {
      code: "FORBIDDEN",
    });
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
    throw new HTTPError("Invalid gs:// URL: missing object path", {
      code: "BAD_REQUEST",
    });
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
  const pathAfterSignature = verifySignature(req.path);
  const parsed = parseProcessingUrl(pathAfterSignature);

  assertOriginAllowed(parsed.sourceUrl);

  // Resolve gs:// URLs to signed HTTP URLs
  const sourceUrl = parsed.sourceUrl.startsWith("gs://")
    ? await resolveGcsUrl(parsed.sourceUrl)
    : parsed.sourceUrl;

  if (isImageUrl(parsed)) {
    // TODO: add instrumentation (timing, source URL, options)
    try {
      const buffer = await processImage(sourceUrl, parsed);
      res.set(
        "Content-Type",
        CONTENT_TYPES[parsed.outputFormat] || "image/jpeg",
      );
      res.set("Cache-Control", env.CACHE_CONTROL);
      res.send(buffer);
    } catch (err) {
      const status = err instanceof HTTPError ? err.status : 500;
      const message =
        err instanceof HTTPError ? err.message : "Error processing image";
      logger.error("Error processing image", {
        error: err instanceof Error ? err.message : String(err),
        sourceUrl: parsed.sourceUrl,
      });
      if (!res.headersSent) {
        res.status(status).send(message);
      }
    }
  } else if (isVideoUrl(parsed)) {
    // TODO: add instrumentation (timing, source URL, options)
    try {
      const result = await processVideo(sourceUrl, parsed);
      res.set(
        "Content-Type",
        CONTENT_TYPES[parsed.outputFormat] || "video/mp4",
      );
      res.set("Cache-Control", env.CACHE_CONTROL);
      result.pipe(res);

      result.on("error", (err) => {
        logger.error("Error processing video (stream)", {
          error: err.message,
          sourceUrl: parsed.sourceUrl,
        });
        if (!res.headersSent) {
          res.status(500).send("Error processing video");
        }
      });
    } catch (err) {
      const status = err instanceof HTTPError ? err.status : 500;
      const message =
        err instanceof HTTPError ? err.message : "Error processing video";
      logger.error("Error processing video", {
        error: err instanceof Error ? err.message : String(err),
        sourceUrl: parsed.sourceUrl,
      });
      if (!res.headersSent) {
        res.status(status).send(message);
      }
    }
  }
}

app.get("/:signature/*rest", handleRequest);

app.get("/health", (_req, res) => {
  res.send("ok");
});

// Error-handling middleware (4 params required for Express to recognise it)
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: express.NextFunction,
  ) => {
    const status = err instanceof HTTPError ? err.status : 500;
    const message =
      err instanceof Error ? err.message : "Internal server error";

    logger.error("Request error", { error: message, status });

    if (!res.headersSent) {
      res.status(status).send(message);
    }
  },
);

async function start() {
  await gpuReady;
  app.listen(env.PORT, () => {
    logger.info(`asset-proxy listening on :${env.PORT}`);
  });
}

start();
