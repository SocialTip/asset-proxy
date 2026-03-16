import express from "express";
import { env } from "./env.js";
import { parseProcessingUrl } from "./url-parser.js";
import { resizeVideo } from "./ffmpeg.js";

const app = express();

app.get("/insecure/*", async (req, res) => {
  try {
    const parsed = parseProcessingUrl(req.path);

    const result = await resizeVideo(parsed.sourceUrl, {
      resizingType: parsed.resize.type,
      width: parsed.resize.width,
      height: parsed.resize.height,
    });

    res.set("Content-Type", "video/mp4");
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    result.pipe(res);

    result.on("error", (err) => {
      console.error("ffmpeg stream error:", err.message);
      if (!res.headersSent) {
        res.status(500).send("Processing failed");
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Request error:", message);
    if (!res.headersSent) {
      res.status(400).send(message);
    }
  }
});

app.get("/health", (_req, res) => {
  res.send("ok");
});

app.listen(env.PORT, () => {
  console.log(`st-assets listening on :${env.PORT}`);
});
