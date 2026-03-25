import { createServer } from "node:http";
import { logger } from "./logger.js";

export function startHealthServer(port: number): void {
  const server = createServer((_req, res) => {
    if (_req.url === "/health" && _req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, "0.0.0.0", () => {
    logger.info(`Health endpoint (HTTP/1.1) listening on :${port}`);
  });
}
