import { PassThrough } from "node:stream";
import { Storage } from "@google-cloud/storage";
import Fastify, {
  type FastifyReply,
  type FastifyRequest,
  type RouteGenericInterface,
} from "fastify";
import type { Http2Server } from "node:http2";
import parseRange from "range-parser";
import { type CacheEnv, env as envSwitched } from "./env.js";
import { h2cFetch } from "./h2c-fetch.js";
import { fastifyOtelInstrumentation } from "./instrument.js";
import { logger } from "./logger.js";
import { tracer } from "./tracing.js";

const env = envSwitched as CacheEnv;

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "host",
]);

function cacheKey(requestPath: string): string {
  return requestPath.startsWith("/") ? requestPath.slice(1) : requestPath;
}

export async function createCacheProxyApp() {
  const gcs = new Storage({
    apiEndpoint: process.env.GCS_API_ENDPOINT || undefined,
  });
  const cacheBucket = gcs.bucket(env.CACHE_BUCKET);
  const inflight = new Map<string, Promise<void>>();
  const app = Fastify({ http2: true });
  await app.register(fastifyOtelInstrumentation.plugin());

  app.get("/health", async (_request, reply) => {
    return reply.send("ok");
  });

  async function serveFromCache(
    request: FastifyRequest<RouteGenericInterface, Http2Server>,
    reply: FastifyReply<RouteGenericInterface, Http2Server>,
    file: ReturnType<typeof cacheBucket.file>,
  ): Promise<void> {
    const span = tracer.startSpan("cache.serveFromCache");
    const metadataSpan = tracer.startSpan("cache.bucket.getMetadata");
    const [metadata] = await file.getMetadata();
    metadataSpan.end();
    const contentType =
      (metadata.contentType as string) ?? "application/octet-stream";
    const fileSize = Number(metadata.size);

    reply.header("Content-Type", contentType);
    reply.header("Cache-Control", env.CACHE_CONTROL);
    reply.header("Accept-Ranges", "bytes");

    const rangeHeader = request.headers.range;
    if (rangeHeader && fileSize > 0) {
      const ranges = parseRange(fileSize, rangeHeader);
      if (ranges === -1 || ranges === -2 || ranges.length !== 1) {
        reply.code(416);
        reply.header("Content-Range", `bytes */${fileSize}`);
        span.end();
        return reply.send();
      } else {
        const { start, end } = ranges[0];
        reply.code(206);
        reply.header("Content-Range", `bytes ${start}-${end}/${fileSize}`);
        reply.header("Content-Length", String(end - start + 1));
        const readStream = file.createReadStream({ start, end });
        const ttfbSpan = tracer.startSpan("cache.bucket.readStream.ttfb");
        readStream.once("data", () => ttfbSpan.end());
        span.end();
        return reply.send(readStream);
      }
    } else {
      if (fileSize > 0) {
        reply.header("Content-Length", String(fileSize));
      }
      const readStream = file.createReadStream();
      const ttfbSpan = tracer.startSpan("cache.bucket.readStream.ttfb");
      readStream.once("data", () => ttfbSpan.end());
      span.end();
      return reply.send(readStream);
    }
  }

  app.get("/*", async (request, reply) => {
    const key = cacheKey(request.url.split("?")[0]);
    if (!key) {
      return reply.code(404).header("Content-Type", "text/plain").send();
    }
    const file = cacheBucket.file(key);

    const pending = inflight.get(key);
    await pending?.catch(() => {
      // Cache write failed — fall through to fetch from upstream.
    });
    const [exists] = await file.exists();
    if (exists) {
      return serveFromCache(request, reply, file);
    }

    const forwardUrl = `${env.FORWARD_URL}${request.url}`;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (
        typeof value === "string" &&
        !HOP_BY_HOP.has(key.toLowerCase()) &&
        key.toLowerCase() !== "range"
      ) {
        headers[key] = value;
      }
    }

    const upstream = await h2cFetch(forwardUrl, { headers });

    reply.code(upstream.status);
    for (const [key, value] of upstream.headers) {
      if (HOP_BY_HOP.has(key.toLowerCase())) continue;
      reply.header(key, value);
    }

    if (!upstream.ok || !upstream.body) {
      if (upstream.body) {
        return reply.send(upstream.body);
      }
      return reply.send();
    }

    const contentType =
      upstream.headers.get("content-type") ?? "application/octet-stream";
    const source = upstream.body;
    const clientStream = new PassThrough();
    const cacheStream = cacheBucket
      .file(key)
      .createWriteStream({ contentType, resumable: false });

    const cacheWrite = new Promise<void>((resolve, reject) => {
      cacheStream.on("finish", resolve);
      cacheStream.on("error", reject);
    });
    inflight.set(key, cacheWrite);
    cacheWrite
      .catch((err) => {
        logger.warn("Failed to write to cache bucket", {
          error: err instanceof Error ? err.message : String(err),
          cacheKey: key,
        });
      })
      .finally(() => {
        inflight.delete(key);
      });

    source.pipe(clientStream);
    source.pipe(cacheStream);
    return reply.send(clientStream);
  });

  app.setErrorHandler((err: Error, _request, reply) => {
    const message = err.message ?? "Internal server error";
    logger.error("Cache proxy error", { error: message });
    if (!reply.sent) {
      reply.code(500).send(message);
    }
  });

  return app;
}
