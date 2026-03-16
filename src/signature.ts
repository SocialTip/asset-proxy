import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";

/**
 * Verifies the HMAC-SHA256 signature of a request path.
 *
 * The signature is the first path segment. When SIGNING_KEY / SIGNING_SALT are
 * not configured the segment is structurally required but any value is accepted.
 * When keys are configured the signature is validated as a URL-safe Base64
 * encoded HMAC-SHA256 digest of: salt + rest_of_path.
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

  const { SIGNING_KEY, SIGNING_SALT } = env;

  // When keys are not configured, accept any signature value
  if (!SIGNING_KEY || !SIGNING_SALT) {
    return restOfPath;
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
