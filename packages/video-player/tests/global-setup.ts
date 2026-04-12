import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { TestProject } from "vitest/node";

const FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/test.mp4",
);
const CONTENT_TYPE = 'video/mp4; codecs="avc1.640028, mp4a.40.2"';

let server: Server;

export async function setup(project: TestProject) {
  server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Headers", "*");
      res.writeHead(204).end();
      return;
    }
    const data = readFileSync(FIXTURE_PATH);
    res.setHeader("Content-Type", CONTENT_TYPE);
    res.end(data);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  server.unref();
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("No address");
  project.provide("fmp4ServerUrl", `http://localhost:${addr.port}`);
}

export function teardown() {
  if (server?.listening) server.close();
}

declare module "vitest" {
  export interface ProvidedContext {
    fmp4ServerUrl: string;
  }
}
