import type { Http2Server } from "node:http2";
import { PassThrough, type Readable } from "node:stream";

import { Storage } from "@google-cloud/storage";
import { HTTPError } from "@socialtip/asset-proxy-url-parser";
import Fastify, {
  type FastifyReply,
  type FastifyRequest,
  type RouteGenericInterface,
} from "fastify";
import parseRange from "range-parser";

import { type CacheEnv, env as envSwitched } from "./env.js";
import { h2Fetch } from "./h2-fetch.js";
import { fastifyOtelInstrumentation } from "./instrument.js";
import { logger } from "./logger.js";
import { tracer } from "./tracing.js";

const env = envSwitched as CacheEnv;

class InflightStream {
  private readonly source: Readable;
  private readonly buffer: Buffer[] = [];
  private ended = false;
  private error: Error | null = null;
  readonly responseHeaders: [string, string][];
  readonly status: number;

  constructor(
    source: Readable,
    responseHeaders: [string, string][],
    status: number,
  ) {
    this.source = source;
    this.responseHeaders = responseHeaders;
    this.status = status;
    source.on("data", (chunk: Buffer) => this.buffer.push(chunk));
    source.on("end", () => {
      this.ended = true;
    });
    source.on("error", (err) => {
      this.error = err;
    });
  }

  subscribe(): PassThrough {
    const pt = new PassThrough();
    if (this.error) {
      pt.destroy(this.error);
      return pt;
    }
    for (const chunk of this.buffer) pt.write(chunk);
    if (this.ended) {
      pt.end();
    } else {
      this.source.pipe(pt, { end: true });
      this.source.on("error", (err) => {
        if (!pt.destroyed) pt.destroy(err);
      });
    }
    return pt;
  }
}

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
  type InflightEntry = {
    stream: Promise<InflightStream | null>;
    cacheWrite: Promise<void>;
  };
  const inflight = new Map<string, InflightEntry>();
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
    if (metadata.etag) {
      reply.header("ETag", metadata.etag as string);
    }
    if (metadata.updated) {
      reply.header(
        "Last-Modified",
        new Date(metadata.updated as string).toUTCString(),
      );
    }

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

    const [exists] = await file.exists();
    if (exists) {
      logger.info("[cache-proxy] hit", { key });
      return serveFromCache(request, reply, file);
    }

    const pending = inflight.get(key);
    if (pending) {
      if (request.headers.range) {
        // For concurrent range requests to the same resource, we wait for the entire result to be buffered to the cache before serving it, so that we can get accurate ranges.
        logger.info("[cache-proxy] miss-concurrent with range", { key });
        await pending.cacheWrite;
        logger.info("[cache-proxy] miss-concurrent with range -> serve", {
          key,
        });
        return serveFromCache(request, reply, file);
      }
      // For concurrent non-range requests to the same resource, we wait for the stream to be available and send it to each client (to save time in case the request stream starts before being fully uploaded to the cache).
      logger.info("[cache-proxy] miss-concurrent without range", { key });
      const res = await Promise.race([pending.stream, pending.cacheWrite]);
      if (!(res instanceof InflightStream)) {
        // Concurrent request to pre-cached resource - serve from cache.
        logger.info("[cache-proxy] miss-concurrent without range -> serve", {
          key,
        });
        return serveFromCache(request, reply, file);
      }
      logger.info("[cache-proxy] miss-concurrent without range -> stream", {
        key,
        status: res.status,
      });
      reply.code(res.status);
      for (const [h, v] of res.responseHeaders) reply.header(h, v);
      return reply.send(res.subscribe());
    }

    logger.info("[cache-proxy] miss", { key });

    let resolveStream!: (value: InflightStream | null) => void;
    let rejectStream!: (err: Error) => void;
    const streamPromise = new Promise<InflightStream | null>(
      (resolve, reject) => {
        resolveStream = resolve;
        rejectStream = reject;
      },
    );
    let resolveCacheWrite!: () => void;
    let rejectCacheWrite!: (err: Error) => void;
    const cacheWrite = new Promise<void>((resolve, reject) => {
      resolveCacheWrite = resolve;
      rejectCacheWrite = reject;
    });
    inflight.set(key, { stream: streamPromise, cacheWrite });

    streamPromise.catch(() => {});
    cacheWrite
      .catch((cause) => {
        logger.warn("Failed to write to cache bucket", {
          cause,
          cacheKey: key,
        });
      })
      .finally(() => {
        logger.info("[cache-proxy] inflight-cleanup", { key });
        inflight.delete(key);
      });

    const forwardUrl = `${env.FORWARD_URL}${request.url}`;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (
        typeof value === "string" &&
        !key.startsWith(":") &&
        !HOP_BY_HOP.has(key.toLowerCase()) &&
        key.toLowerCase() !== "range"
      ) {
        headers[key] = value;
      }
    }

    const upstream = await h2Fetch(forwardUrl, { headers }).catch((cause) => {
      logger.error("Failed to fetch from upstream", { cause, key });
      const error = new HTTPError("Upstream request failed", {
        code: "BAD_GATEWAY",
      });
      rejectStream(error);
      rejectCacheWrite(error);
      throw error;
    });

    reply.code(upstream.status);
    for (const [key, value] of upstream.headers) {
      if (HOP_BY_HOP.has(key.toLowerCase())) continue;
      reply.header(key, value);
    }

    if (!upstream.ok || !upstream.body) {
      logger.error("Upstream request failed or response empty", {
        key,
        status: upstream.status,
        body: upstream.body,
      });
      const error = new HTTPError("Upstream request failed", {
        code: "BAD_GATEWAY",
      });
      rejectStream(error);
      rejectCacheWrite(error);
      throw error;
    }

    const contentType =
      upstream.headers.get("content-type") ?? "application/octet-stream";
    const source = upstream.body;

    const responseHeaders: [string, string][] = [];
    for (const [h, v] of upstream.headers) {
      if (!HOP_BY_HOP.has(h.toLowerCase())) responseHeaders.push([h, v]);
    }

    const stream = new InflightStream(source, responseHeaders, upstream.status);
    resolveStream(stream);

    let cacheWriteStarted = false;
    source.once("data", () => {
      cacheWriteStarted = true;
      logger.info("[cache-proxy] starting cache write", { key });
      const cacheStream = cacheBucket
        .file(key)
        .createWriteStream({ contentType, resumable: false });
      cacheStream.on("finish", resolveCacheWrite);
      cacheStream.on("error", (cause) => {
        logger.error("[cache-proxy] cache write stream error", {
          key,
          cause,
        });
        rejectCacheWrite(cause);
      });
      stream.subscribe().pipe(cacheStream);
    });
    source.once("end", () => {
      if (!cacheWriteStarted) {
        logger.error("[cache-proxy] source ended without data", { key });
        rejectCacheWrite(new Error("Source ended without data"));
      }
    });
    source.once("error", (cause) => {
      logger.error("[cache-proxy] source stream error", {
        key,
        cacheWriteStarted,
        cause,
      });
      rejectCacheWrite(cause);
    });

    return reply.send(stream.subscribe());
  });

  return app;
}
