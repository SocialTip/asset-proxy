import { PassThrough, type Readable } from "node:stream";
import { Storage } from "@google-cloud/storage";
import Fastify, {
  type FastifyReply,
  type FastifyRequest,
  type RouteGenericInterface,
} from "fastify";
import type { Http2Server } from "node:http2";
import parseRange from "range-parser";
import { type CacheEnv, env as envSwitched } from "./env.js";
import { h2Fetch } from "./h2-fetch.js";
import { fastifyOtelInstrumentation } from "./instrument.js";
import { logger } from "./logger.js";
import { tracer, recordException } from "./tracing.js";

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
  const inflight = new Map<
    string,
    { stream: InflightStream; cacheWrite: Promise<void> }
  >();
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

    const pending = inflight.get(key);
    if (pending) {
      if (request.headers.range) {
        await pending.cacheWrite.catch(() => {});
      } else {
        reply.code(pending.stream.status);
        for (const [h, v] of pending.stream.responseHeaders) reply.header(h, v);
        return reply.send(pending.stream.subscribe());
      }
    }

    const [exists] = await file.exists();
    if (exists) {
      return serveFromCache(request, reply, file);
    }

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

    const upstream = await h2Fetch(forwardUrl, { headers });

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
    const cacheStream = cacheBucket
      .file(key)
      .createWriteStream({ contentType, resumable: false });

    const responseHeaders: [string, string][] = [];
    for (const [h, v] of upstream.headers) {
      if (!HOP_BY_HOP.has(h.toLowerCase())) responseHeaders.push([h, v]);
    }
    const mux = new InflightStream(source, responseHeaders, upstream.status);
    const cacheWrite = new Promise<void>((resolve, reject) => {
      cacheStream.on("finish", resolve);
      cacheStream.on("error", reject);
    });
    inflight.set(key, { stream: mux, cacheWrite });
    source.pipe(cacheStream);
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

    return reply.send(mux.subscribe());
  });

  app.setErrorHandler((cause: Error, request, reply) => {
    const error = new Error("Cache proxy error", { cause });
    logger.error("Cache proxy error", {
      message: cause instanceof Error ? cause.message : undefined,
      cause,
    });
    const { span } = request.opentelemetry();
    if (span) recordException(span, error);
    if (!reply.sent) {
      return reply.code(500).send("Unhandled error");
    }
  });

  return app;
}
