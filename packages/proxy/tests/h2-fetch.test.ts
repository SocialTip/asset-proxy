import fs from "node:fs";
import http2 from "node:http2";
import path from "node:path";
import { h2Fetch } from "@/h2-fetch.js";

const certsDir = path.resolve(__dirname, "fixtures/certs");
const key = fs.readFileSync(path.join(certsDir, "key.pem"));
const cert = fs.readFileSync(path.join(certsDir, "cert.pem"));

let h2cServer: http2.Http2Server;
let h2cPort: number;
let h2sServer: http2.Http2SecureServer;
let h2sPort: number;

beforeAll(async () => {
  h2cServer = http2.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("h2c ok");
  });
  await new Promise<void>((resolve) => h2cServer.listen(0, resolve));
  h2cPort = (h2cServer.address() as { port: number }).port;

  h2sServer = http2.createSecureServer({ key, cert }, (_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("h2 tls ok");
  });
  await new Promise<void>((resolve) => h2sServer.listen(0, resolve));
  h2sPort = (h2sServer.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => h2cServer.close(() => resolve()));
  await new Promise<void>((resolve) => h2sServer.close(() => resolve()));
});

async function bodyText(
  res: Awaited<ReturnType<typeof h2Fetch>>,
): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of res.body!) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

describe("h2Fetch", () => {
  it("fetches over h2c for http:// URLs", async () => {
    const res = await h2Fetch(`http://localhost:${h2cPort}/test`);
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(await bodyText(res)).toBe("h2c ok");
  });

  it("fetches over h2 TLS for https:// URLs", async () => {
    const res = await h2Fetch(`https://localhost:${h2sPort}/test`);
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(await bodyText(res)).toBe("h2 tls ok");
  });
});
