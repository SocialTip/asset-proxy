import "./instrument.js";
import { createHash } from "node:crypto";
import contentDisposition from "content-disposition";
import { Storage } from "@google-cloud/storage";
import express from "express";
import {
  HTTPError,
  isImageUrl,
  isVideoUrl,
  parseProcessingUrl,
  verifySignature,
} from "@socialtip/asset-proxy-url-parser";
import { env } from "./env.js";
import { gpuReady, processImage, processVideo } from "./ffmpeg.js";
import { logger } from "./logger.js";

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

function shouldSkipProcessing(
  parsed: ReturnType<typeof parseProcessingUrl>,
): boolean {
  if (parsed.raw) return true;
  if (parsed.skipProcessing?.length) {
    const ext = parsed.sourceUrl
      .match(/\.([a-z0-9]+)(?:[?#]|$)/i)?.[1]
      ?.toLowerCase();
    if (ext && parsed.skipProcessing.includes(ext === "jpeg" ? "jpg" : ext)) {
      return true;
    }
  }
  return false;
}

async function verifyHashsum(
  sourceUrl: string,
  hashsum: { type: string; hash: string },
): Promise<void> {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new HTTPError(`Failed to fetch source: ${response.status}`, {
      code: "BAD_REQUEST",
    });
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const digest = createHash(hashsum.type).update(buffer).digest("hex");
  if (digest !== hashsum.hash) {
    throw new HTTPError(
      `Source hashsum mismatch: expected ${hashsum.hash}, got ${digest}`,
      { code: "UNPROCESSABLE_ENTITY" },
    );
  }
}

function setContentDisposition(
  res: express.Response,
  parsed: ReturnType<typeof parseProcessingUrl>,
): void {
  if (parsed.filename || parsed.returnAttachment) {
    const type = parsed.returnAttachment ? "attachment" : "inline";
    res.set(
      "Content-Disposition",
      contentDisposition(parsed.filename ?? undefined, { type }),
    );
  }
}

async function handleRequest(req: express.Request, res: express.Response) {
  const pathAfterSignature = verifySignature(req.path, {
    signingKey: env.SIGNING_KEY,
    signingSalt: env.SIGNING_SALT,
  });
  const parsed = parseProcessingUrl(pathAfterSignature, {
    encryptionKey: env.SOURCE_URL_ENCRYPTION_KEY,
  });

  assertOriginAllowed(parsed.sourceUrl);

  if (parsed.expires && Date.now() / 1000 > parsed.expires) {
    throw new HTTPError("URL has expired", { code: "NOT_FOUND" });
  }

  // Resolve gs:// URLs to signed HTTP URLs
  const sourceUrl = parsed.sourceUrl.startsWith("gs://")
    ? await resolveGcsUrl(parsed.sourceUrl)
    : parsed.sourceUrl;

  if (parsed.hashsum) {
    await verifyHashsum(sourceUrl, parsed.hashsum);
  }

  try {
    await processAndRespond(req, res, parsed, sourceUrl);
  } catch (err) {
    if (parsed.fallbackImageUrl && !res.headersSent) {
      const fallbackUrl = Buffer.from(
        parsed.fallbackImageUrl,
        "base64url",
      ).toString("utf-8");
      logger.info("Falling back to fallback image", {
        sourceUrl: parsed.sourceUrl,
        fallbackUrl,
        error: err instanceof Error ? err.message : String(err),
      });
      res.redirect(302, fallbackUrl);
      return;
    }
    throw err;
  }
}

async function processAndRespond(
  _req: express.Request,
  res: express.Response,
  parsed: ReturnType<typeof parseProcessingUrl>,
  sourceUrl: string,
): Promise<void> {
  if (shouldSkipProcessing(parsed)) {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new HTTPError(`Failed to fetch source: ${response.status}`, {
        code: "BAD_REQUEST",
      });
    }
    const contentType = response.headers.get("content-type");
    if (contentType) res.set("Content-Type", contentType);
    res.set("Cache-Control", env.CACHE_CONTROL);
    setContentDisposition(res, parsed);
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
    return;
  }

  if (isImageUrl(parsed)) {
    try {
      const result = await processImage(sourceUrl, parsed);
      res.set(
        "Content-Type",
        CONTENT_TYPES[result.outputFormat] || "image/jpeg",
      );
      res.set("Cache-Control", env.CACHE_CONTROL);
      setContentDisposition(res, parsed);
      res.send(result.buffer);
    } catch (err) {
      if (err instanceof HTTPError) throw err;
      logger.error("Error processing image", {
        error: err instanceof Error ? err.message : String(err),
        sourceUrl: parsed.sourceUrl,
      });
      throw new HTTPError("Error processing image", {
        code: "INTERNAL_SERVER_ERROR",
      });
    }
  } else if (isVideoUrl(parsed)) {
    try {
      const result = await processVideo(sourceUrl, parsed);
      res.set(
        "Content-Type",
        CONTENT_TYPES[parsed.outputFormat] || "video/mp4",
      );
      res.set("Cache-Control", env.CACHE_CONTROL);
      setContentDisposition(res, parsed);
      result.pipe(res);

      await new Promise<void>((resolve, reject) => {
        result.on("end", resolve);
        result.on("error", reject);
      });
    } catch (err) {
      if (err instanceof HTTPError) throw err;
      logger.error("Error processing video", {
        error: err instanceof Error ? err.message : String(err),
        sourceUrl: parsed.sourceUrl,
      });
      throw new HTTPError("Error processing video", {
        code: "INTERNAL_SERVER_ERROR",
      });
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
