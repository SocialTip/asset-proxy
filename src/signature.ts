import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";

/**
 * Verifies the HMAC-SHA256 signature of a request path.
 *
 * The signature is the first path segment. It is a URL-safe Base64 encoded
 * HMAC-SHA256 digest of: salt + rest_of_path (everything after the signature segment).
 *
 * When SIGNING_KEY is not configured, only `/insecure/` prefixed paths are accepted.
 */
export function verifySignature(path: string): string {
  // Strip leading slash, split into [signature, ...rest]
  const withoutLeadingSlash = path.slice(1);
  const slashIdx = withoutLeadingSlash.indexOf("/");
  if (slashIdx === -1) {
    throw new Error("Invalid URL: missing path segments");
  }

  const signature = withoutLeadingSlash.slice(0, slashIdx);
  const restOfPath = withoutLeadingSlash.slice(slashIdx); // includes leading /

  if (signature === "insecure") {
    return restOfPath;
  }

  const { SIGNING_KEY, SIGNING_SALT } = env;
  if (!SIGNING_KEY) {
    throw new Error("Signed URLs are not supported: SIGNING_KEY is not set");
  }
  if (!SIGNING_SALT) {
    throw new Error("Signed URLs are not supported: SIGNING_SALT is not set");
  }

  const expected = sign(restOfPath, SIGNING_KEY, SIGNING_SALT);

  const sigBuf = Buffer.from(signature, "base64url");
  const expectedBuf = Buffer.from(expected, "base64url");

  if (
    sigBuf.length !== expectedBuf.length ||
    !timingSafeEqual(sigBuf, expectedBuf)
  ) {
    throw new Error("Invalid signature");
  }

  return restOfPath;
}

function sign(path: string, key: Buffer, salt: Buffer): string {
  const hmac = createHmac("sha256", key);
  hmac.update(salt);
  hmac.update(path);
  return hmac.digest("base64url");
}
