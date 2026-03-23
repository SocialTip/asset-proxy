import type { UrlGeneratorConfig } from "@socialtip/asset-proxy-url-generator";

export const SERVICE_URL = process.env.SERVICE_URL ?? "http://localhost:8080";

export const URL_CONFIG: UrlGeneratorConfig = {
  encryptionKey:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  deterministicEncryption: true,
  signingKey:
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  signingSalt:
    "cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe",
};

beforeAll(async () => {
  try {
    const res = await fetch(`${SERVICE_URL}/health`);
    if (res.ok) return;
  } catch {
    // not reachable
  }
  throw new Error(
    `Service at ${SERVICE_URL} is not running. Run \`pnpm test:up\` to start it via Docker Compose.`,
  );
});
