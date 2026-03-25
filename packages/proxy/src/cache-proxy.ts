import { PassThrough, Readable } from "node:stream";
import { Storage } from "@google-cloud/storage";
import express from "express";
import { type CacheEnv, env as envSwitched } from "./env.js";
import { logger } from "./logger.js";

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

function parseRangeHeader(
  header: string,
  fileSize: number,
): { start: number; end: number } | null {
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  let start: number;
  let end: number;

  if (match[1] === "" && match[2] !== "") {
    const suffix = Number(match[2]);
    start = Math.max(0, fileSize - suffix);
    end = fileSize - 1;
  } else if (match[2] === "") {
    start = Number(match[1]);
    end = fileSize - 1;
  } else {
    start = Number(match[1]);
    end = Math.min(Number(match[2]), fileSize - 1);
  }

  if (start > end || start >= fileSize) return null;
  return { start, end };
}

export function createCacheProxyApp(): express.Express {
  const gcs = new Storage({
    apiEndpoint: process.env.GCS_API_ENDPOINT || undefined,
  });
  const cacheBucket = gcs.bucket(env.CACHE_BUCKET);
  const inflight = new Map<string, Promise<void>>();
  const app = express();

  app.get("/health", (_req, res) => {
    res.send("ok");
  });

  function serveFromCache(
    req: express.Request,
    res: express.Response,
    file: ReturnType<typeof cacheBucket.file>,
  ): void {
    file.getMetadata().then(([metadata]) => {
      const contentType =
        (metadata.contentType as string) ?? "application/octet-stream";
      const fileSize = Number(metadata.size);

      res.set("Content-Type", contentType);
      res.set("Cache-Control", env.CACHE_CONTROL);
      res.set("Accept-Ranges", "bytes");

      const rangeHeader = req.headers.range;
      if (rangeHeader && fileSize > 0) {
        const range = parseRangeHeader(rangeHeader, fileSize);
        if (range) {
          res.status(206);
          res.set(
            "Content-Range",
            `bytes ${range.start}-${range.end}/${fileSize}`,
          );
          res.set("Content-Length", String(range.end - range.start + 1));
          file
            .createReadStream({ start: range.start, end: range.end })
            .pipe(res);
        } else {
          res.status(416);
          res.set("Content-Range", `bytes */${fileSize}`);
          res.end();
        }
      } else {
        if (fileSize > 0) res.set("Content-Length", String(fileSize));
        file.createReadStream().pipe(res);
      }
    });
  }

  app.use(
    async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      try {
        const key = cacheKey(req.path);
        const file = cacheBucket.file(key);

        const pending = inflight.get(key);
        if (pending) {
          try {
            await pending;
          } catch {
            // Cache write failed — fall through to fetch from upstream.
          }
          const [exists] = await file.exists();
          if (exists) {
            serveFromCache(req, res, file);
            return;
          }
        } else {
          const [exists] = await file.exists();
          if (exists) {
            serveFromCache(req, res, file);
            return;
          }
        }

        const forwardUrl = `${env.FORWARD_URL}${req.originalUrl}`;
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (
            typeof value === "string" &&
            !HOP_BY_HOP.has(key.toLowerCase()) &&
            key.toLowerCase() !== "range"
          ) {
            headers[key] = value;
          }
        }

        const upstream = await fetch(forwardUrl, { headers });

        res.status(upstream.status);
        for (const [key, value] of upstream.headers) {
          if (!HOP_BY_HOP.has(key.toLowerCase())) {
            res.set(key, value);
          }
        }

        if (!upstream.ok || !upstream.body) {
          if (upstream.body) {
            Readable.fromWeb(
              upstream.body as import("node:stream/web").ReadableStream,
            ).pipe(res);
          } else {
            res.end();
          }
          return;
        }

        const contentType =
          upstream.headers.get("content-type") ?? "application/octet-stream";
        const source = Readable.fromWeb(
          upstream.body as import("node:stream/web").ReadableStream,
        );
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
        clientStream.pipe(res);
      } catch (err) {
        next(err);
      }
    },
  );

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction,
    ) => {
      const message =
        err instanceof Error ? err.message : "Internal server error";
      logger.error("Cache proxy error", { error: message });
      if (!res.headersSent) {
        res.status(500).send(message);
      }
    },
  );

  return app;
}
