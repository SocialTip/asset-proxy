import express from "express";
import { env } from "./env.js";
import { parseProcessingUrl } from "./url-parser.js";
import { gpuReady, resizeVideo } from "./ffmpeg.js";
import { logger } from "./logger.js";
import { verifySignature } from "./signature.js";

const app = express();

async function handleResize(req: express.Request, res: express.Response) {
  try {
    const pathAfterSignature = verifySignature(req.path);
    const parsed = parseProcessingUrl(pathAfterSignature);

    const result = await resizeVideo(parsed.sourceUrl, {
      resizingType: parsed.resize.type,
      width: parsed.resize.width,
      height: parsed.resize.height,
      outputFormat: parsed.outputFormat,
    });

    const contentType =
      parsed.outputFormat === "webm" ? "video/webm" : "video/mp4";
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    result.pipe(res);

    result.on("error", (err) => {
      logger.error("ffmpeg stream error", { error: err.message });
      if (!res.headersSent) {
        res.status(500).send("Processing failed");
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message === "Invalid signature" ? 403 : 400;
    logger.error("Request error", { error: message, status });
    if (!res.headersSent) {
      res.status(status).send(message);
    }
  }
}

app.get("/insecure/{*rest}", handleResize);
app.get("/{signature}/{*rest}", handleResize);

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
