import { Storage } from "@google-cloud/storage";
import express from "express";
import proxy from "express-http-proxy";
import { type CacheEnv, env as envSwitched } from "./env.js";
import { logger } from "./logger.js";

const env = envSwitched as CacheEnv;

function cacheKey(requestPath: string): string {
  return requestPath.startsWith("/") ? requestPath.slice(1) : requestPath;
}

export function createCacheProxyApp(): express.Express {
  const gcs = new Storage({
    apiEndpoint: process.env.GCS_API_ENDPOINT || undefined,
  });
  const cacheBucket = gcs.bucket(env.CACHE_BUCKET);
  const app = express();

  app.get("/health", (_req, res) => {
    res.send("ok");
  });

  app.use(async (req, res, next) => {
    try {
      const key = cacheKey(req.path);
      const file = cacheBucket.file(key);

      const [exists] = await file.exists();
      if (exists) {
        const [metadata] = await file.getMetadata();
        const contentType =
          (metadata.contentType as string) ?? "application/octet-stream";
        res.set("Content-Type", contentType);
        res.set("Cache-Control", env.CACHE_CONTROL);
        file.createReadStream().pipe(res);
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  });

  app.use(
    proxy(env.FORWARD_URL, {
      proxyReqPathResolver: (req) => req.originalUrl,
      userResDecorator: (proxyRes, proxyResData, userReq) => {
        if (
          proxyRes.statusCode &&
          proxyRes.statusCode >= 200 &&
          proxyRes.statusCode < 300
        ) {
          const key = cacheKey(userReq.path);
          const contentType =
            proxyRes.headers["content-type"] ?? "application/octet-stream";
          const stream = cacheBucket
            .file(key)
            .createWriteStream({ contentType, resumable: false });
          stream.on("error", (err) => {
            logger.warn("Failed to write to cache bucket", {
              error: err instanceof Error ? err.message : String(err),
              cacheKey: key,
            });
          });
          stream.end(proxyResData);
        }
        return proxyResData;
      },
      proxyErrorHandler: (err, res, next) => {
        next(err);
      },
    }),
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
