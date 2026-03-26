import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import contentDisposition from "content-disposition";
import { Storage } from "@google-cloud/storage";
import Fastify from "fastify";
import type {
  FastifyReply,
  FastifyRequest,
  RouteGenericInterface,
} from "fastify";
import type { Http2Server } from "node:http2";
import {
  HTTPError,
  isImageUrl,
  isVideoUrl,
  parseProcessingUrl,
  verifySignature,
} from "@socialtip/asset-proxy-url-parser";
import { type ProcessingEnv, env as envSwitched, isCacheMode } from "./env.js";
import { startHealthServer } from "./health-server.js";
import { fastifyOtelInstrumentation } from "./instrument.js";

const env = envSwitched as ProcessingEnv;
import { gpuReady, processImage, processVideo } from "./ffmpeg.js";
import { handleInfoRequest } from "./info.js";
import { logger } from "./logger.js";
import { recordException, tracer, withSpan } from "./tracing.js";

const execFileAsync = promisify(execFile);

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

export const app = Fastify({ http2: true });
app.register(fastifyOtelInstrumentation.plugin());

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

  return withSpan(
    "gcs.getSignedUrl",
    { "gcs.bucket": bucket, "gcs.object": objectPath },
    async () => {
      const [signedUrl] = await gcs
        .bucket(bucket)
        .file(objectPath)
        .getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + 15 * 60 * 1000, // 15 minutes
        });

      return signedUrl;
    },
  );
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

async function checkSourceLimits(
  sourceUrl: string,
  parsed: ReturnType<typeof parseProcessingUrl>,
): Promise<void> {
  const maxFileSize = parsed.maxSrcFileSize ?? env.MAX_SRC_FILE_SIZE;
  const maxResolution = parsed.maxSrcResolution ?? env.MAX_SRC_RESOLUTION;

  if (!maxFileSize && !maxResolution) return;

  if (maxFileSize) {
    const response = await fetch(sourceUrl, { method: "HEAD" });
    if (response.ok) {
      const contentLength = response.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > maxFileSize) {
        throw new HTTPError(
          `Source file size ${contentLength} exceeds limit of ${maxFileSize} bytes`,
          { code: "UNPROCESSABLE_ENTITY" },
        );
      }
    }
  }

  if (maxResolution) {
    try {
      const { stdout } = await withSpan("exec.ffprobe.resolution", {}, () =>
        execFileAsync("ffprobe", [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=width,height",
          "-of",
          "json",
          sourceUrl,
        ]),
      );
      const probe = JSON.parse(stdout);
      const stream = probe.streams?.[0];
      if (stream?.width && stream?.height) {
        const mp = (stream.width * stream.height) / 1_000_000;
        if (mp > maxResolution) {
          throw new HTTPError(
            `Source resolution ${mp.toFixed(1)}MP exceeds limit of ${maxResolution}MP`,
            { code: "UNPROCESSABLE_ENTITY" },
          );
        }
      }
    } catch (err) {
      if (err instanceof HTTPError) throw err;
      logger.warn("Failed to probe source resolution", {
        error: err instanceof Error ? err.message : String(err),
        sourceUrl,
      });
    }
  }
}

function checkResultLimits(
  parsed: ReturnType<typeof parseProcessingUrl>,
): void {
  const maxDim = parsed.maxResultDimension ?? env.MAX_RESULT_DIMENSION;
  if (!maxDim) return;

  const w = parsed.resize?.width ?? 0;
  const h = parsed.resize?.height ?? 0;
  if ((w && w > maxDim) || (h && h > maxDim)) {
    throw new HTTPError(
      `Result dimension ${Math.max(w, h)} exceeds limit of ${maxDim} pixels`,
      { code: "UNPROCESSABLE_ENTITY" },
    );
  }
}

function checkAnimationLimits(
  parsed: ReturnType<typeof parseProcessingUrl>,
): void {
  const maxFrames = parsed.maxAnimationFrames ?? env.MAX_ANIMATION_FRAMES;
  const maxFrameRes =
    parsed.maxAnimationFrameResolution ?? env.MAX_ANIMATION_FRAME_RESOLUTION;

  if (maxFrames && parsed.videoThumbnailAnimation) {
    const frames = parsed.videoThumbnailAnimation.frames;
    if (frames && frames > maxFrames) {
      throw new HTTPError(
        `Animation frame count ${frames} exceeds limit of ${maxFrames}`,
        { code: "UNPROCESSABLE_ENTITY" },
      );
    }
  }

  if (maxFrameRes && parsed.videoThumbnailAnimation) {
    const fw = parsed.videoThumbnailAnimation.frameWidth;
    const fh = parsed.videoThumbnailAnimation.frameHeight;
    if (fw && fh) {
      const mp = (fw * fh) / 1_000_000;
      if (mp > maxFrameRes) {
        throw new HTTPError(
          `Animation frame resolution ${mp.toFixed(1)}MP exceeds limit of ${maxFrameRes}MP`,
          { code: "UNPROCESSABLE_ENTITY" },
        );
      }
    }
  }
}

const FORMAT_EXTENSIONS: Record<string, string> = {
  mp4: ".mp4",
  webm: ".webm",
  jpg: ".jpg",
  png: ".png",
  webp: ".webp",
  avif: ".avif",
  gif: ".gif",
};

type AppRequest = FastifyRequest<RouteGenericInterface, Http2Server>;
type AppReply = FastifyReply<RouteGenericInterface, Http2Server>;

function setContentDisposition(
  reply: AppReply,
  parsed: ReturnType<typeof parseProcessingUrl>,
  outputFormat?: string,
): void {
  let filename = parsed.filename;
  if (filename && outputFormat) {
    const ext = FORMAT_EXTENSIONS[outputFormat];
    if (ext) filename = filename.replace(/\.[^.]+$/, ext);
  }
  if (!filename && outputFormat) {
    filename = `image${FORMAT_EXTENSIONS[outputFormat] ?? ""}`;
  }
  const type = parsed.returnAttachment ? "attachment" : "inline";
  reply.header(
    "Content-Disposition",
    contentDisposition(filename ?? undefined, { type }),
  );
}

async function handleRequest(request: AppRequest, reply: AppReply) {
  const span = tracer.startSpan("asset-proxy.request");
  try {
    const pathAfterSignature = verifySignature(request.url.split("?")[0], {
      signingKey: env.SIGNING_KEY,
      signingSalt: env.SIGNING_SALT,
    });
    const parsed = parseProcessingUrl(pathAfterSignature, {
      encryptionKey: env.SOURCE_URL_ENCRYPTION_KEY,
    });

    span.setAttributes({
      "asset_proxy.source_scheme": parsed.sourceUrl.startsWith("gs://")
        ? "gs"
        : "http",
      "asset_proxy.output_format": parsed.outputFormat,
      "asset_proxy.media_type": isImageUrl(parsed)
        ? "image"
        : isVideoUrl(parsed)
          ? "video"
          : "unknown",
      ...(parsed.resize?.width && {
        "asset_proxy.resize_width": parsed.resize.width,
      }),
      ...(parsed.resize?.height && {
        "asset_proxy.resize_height": parsed.resize.height,
      }),
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

    checkResultLimits(parsed);
    checkAnimationLimits(parsed);
    await checkSourceLimits(sourceUrl, parsed);

    try {
      await processAndRespond(reply, parsed, sourceUrl);
    } catch (err) {
      if (parsed.fallbackImageUrl && !reply.sent) {
        const fallbackUrl = Buffer.from(
          parsed.fallbackImageUrl,
          "base64url",
        ).toString("utf-8");
        logger.info("Falling back to fallback image", {
          sourceUrl: parsed.sourceUrl,
          fallbackUrl,
          error: err instanceof Error ? err.message : String(err),
        });
        return reply.redirect(fallbackUrl, 302);
      }
      throw err;
    }
  } catch (err) {
    recordException(span, err);
    throw err;
  } finally {
    span.end();
  }
}

async function processAndRespond(
  reply: AppReply,
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
    if (contentType) reply.header("Content-Type", contentType);
    reply.header("Cache-Control", env.CACHE_CONTROL);
    setContentDisposition(reply, parsed);
    const contentLength = response.headers.get("content-length");
    if (contentLength) reply.header("Content-Length", contentLength);
    const responseSpan = tracer.startSpan("response.stream");
    const raw = Readable.fromWeb(
      response.body as import("node:stream/web").ReadableStream,
    );
    raw.on("end", () => responseSpan.end());
    raw.on("error", () => responseSpan.end());
    return reply.send(raw);
  }

  if (isImageUrl(parsed)) {
    try {
      const result = await withSpan("processImage", {}, () =>
        processImage(sourceUrl, parsed),
      );
      const contentType = CONTENT_TYPES[result.outputFormat] || "image/jpeg";
      reply.header("Content-Type", contentType);
      reply.header("Cache-Control", env.CACHE_CONTROL);
      setContentDisposition(reply, parsed, result.outputFormat);
      return reply.send(result.buffer);
    } catch (err) {
      if (err instanceof HTTPError) throw err;
      logger.error("Error processing image", {
        error: err instanceof Error ? err.message : String(err),
        sourceUrl: parsed.sourceUrl,
      });
      throw new HTTPError("Unhandled error", {
        code: "INTERNAL_SERVER_ERROR",
      });
    }
  } else if (isVideoUrl(parsed)) {
    try {
      const result = await withSpan("processVideo", {}, () =>
        processVideo(sourceUrl, parsed),
      );

      if (!result.buffer.length) {
        throw new HTTPError("Video processing produced no output", {
          code: "INTERNAL_SERVER_ERROR",
        });
      }

      const contentType = CONTENT_TYPES[result.outputFormat] || "video/mp4";
      reply.header("Content-Type", contentType);
      reply.header("Cache-Control", env.CACHE_CONTROL);
      setContentDisposition(reply, parsed, result.outputFormat);
      return reply.send(result.buffer);
    } catch (err) {
      if (err instanceof HTTPError) throw err;
      logger.error("Error processing video", {
        error: err instanceof Error ? err.message : String(err),
        sourceUrl: parsed.sourceUrl,
      });
      throw new HTTPError("Unhandled error", {
        code: "INTERNAL_SERVER_ERROR",
      });
    }
  }
}

app.get("/info/:signature/*", async (request, reply) =>
  handleInfoRequest(request, reply),
);

app.get("/:signature/*", async (request, reply) =>
  handleRequest(request, reply),
);

app.get("/health", async (_request, reply) => {
  return reply.send("ok");
});

app.setErrorHandler((cause: Error, request, reply) => {
  const status = cause instanceof HTTPError ? cause.status : 500;
  const message =
    cause instanceof HTTPError ? cause.message : "Unhandled error";

  const error = new Error("Processor error", { cause });
  logger.error("Processor error", {
    message: cause instanceof Error ? cause.message : undefined,
    cause,
  });
  const { span } = request.opentelemetry();
  if (span) recordException(span, error);
  if (!reply.sent) {
    return reply.code(status).send(message);
  }
});

async function start() {
  let server: { close(): Promise<void> };

  if (isCacheMode(envSwitched)) {
    const cacheEnv = envSwitched;
    const { createCacheProxyApp } = await import("./cache-proxy.js");
    const cacheApp = await createCacheProxyApp();
    await cacheApp.listen({ port: cacheEnv.PORT, host: "0.0.0.0" });
    logger.info(`asset-proxy (cache mode) listening on :${cacheEnv.PORT}`, {
      version: process.env.BUILD_VERSION ?? "<unset>",
      forwardUrl: cacheEnv.FORWARD_URL,
    });
    server = cacheApp;
  } else {
    await gpuReady;
    try {
      await app.listen({ port: env.PORT, host: "0.0.0.0" });
    } catch (err) {
      logger.error("Server error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    logger.info(`asset-proxy listening on :${env.PORT}`, {
      version: process.env.BUILD_VERSION ?? "<unset>",
    });
    server = app;
  }

  if (envSwitched.HEALTH_PORT) {
    startHealthServer(envSwitched.HEALTH_PORT);
  }

  if (process.env.NODE_V8_COVERAGE) {
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.on(signal, () => {
        server.close().finally(() => process.exit(0));
        setTimeout(() => process.exit(0), 5000).unref();
      });
    }
  }
}

start();
