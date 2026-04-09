import http2 from "node:http2";

import type { UrlGeneratorConfig } from "@socialtip/asset-proxy-url-generator";

export const SERVICE_URL = process.env.SERVICE_URL ?? "http://localhost:8080";
export const CACHE_PROXY_URL =
  process.env.CACHE_PROXY_URL ?? "http://localhost:8081";

export const URL_CONFIG: UrlGeneratorConfig = {
  encryptionKey:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  deterministicEncryption: true,
  signingKey:
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  signingSalt:
    "cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe",
};

export function h2Fetch(
  url: string | URL,
  init?: { headers?: Record<string, string> },
): Promise<Response> {
  const parsed = typeof url === "string" ? new URL(url) : url;
  return new Promise((resolve, reject) => {
    const client = http2.connect(`http://${parsed.host}`);
    client.on("error", reject);
    const reqHeaders: http2.OutgoingHttpHeaders = {
      ":path": parsed.pathname + parsed.search,
      ":method": "GET",
      ...init?.headers,
    };
    const req = client.request(reqHeaders);
    req.on("response", (headers) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const status = Number(headers[":status"]);
        const responseHeaders = new Headers();
        for (const [k, v] of Object.entries(headers)) {
          if (!k.startsWith(":") && v != null) {
            responseHeaders.set(k, String(v));
          }
        }
        const body = Buffer.concat(chunks);
        resolve(new Response(body, { status, headers: responseHeaders }));
        client.close();
      });
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  try {
    const res = await h2Fetch(`${SERVICE_URL}/health`);
    if (res.ok) return;
  } catch {
    // not reachable
  }
  throw new Error(
    `Service at ${SERVICE_URL} is not running. Run \`pnpm test:up\` to start it via Docker Compose.`,
  );
});
