import { createHmac, timingSafeEqual } from "node:crypto";
import { HTTPError } from "./error.js";

export interface SignatureOptions {
  signingKey?: Buffer;
  signingSalt?: Buffer;
}

/**
 * Verifies the HMAC-SHA256 signature of a request path.
 *
 * The signature is the first path segment. When signingKey / signingSalt are
 * not provided the segment is structurally required but any value is accepted.
 * When keys are provided the signature is validated as a URL-safe Base64
 * encoded HMAC-SHA256 digest of: salt + rest_of_path.
 */
export function verifySignature(
  path: string,
  options?: SignatureOptions,
): string {
  const withoutLeadingSlash = path.slice(1);
  const slashIdx = withoutLeadingSlash.indexOf("/");
  if (slashIdx === -1) {
    throw new HTTPError("Invalid URL: missing path segments", {
      code: "BAD_REQUEST",
    });
  }

  const signature = withoutLeadingSlash.slice(0, slashIdx);
  const restOfPath = withoutLeadingSlash.slice(slashIdx); // includes leading /

  if (!options?.signingKey || !options?.signingSalt) {
    return restOfPath;
  }

  const expected = sign(restOfPath, options.signingKey, options.signingSalt);

  const sigBuf = Buffer.from(signature, "base64url");
  const expectedBuf = Buffer.from(expected, "base64url");

  if (
    sigBuf.length !== expectedBuf.length ||
    !timingSafeEqual(sigBuf, expectedBuf)
  ) {
    throw new HTTPError("Invalid signature", {
      code: "FORBIDDEN",
    });
  }

  return restOfPath;
}

/** Generates a URL-safe Base64 HMAC-SHA256 signature for the given path. */
export function sign(path: string, key: Buffer, salt: Buffer): string {
  const hmac = createHmac("sha256", key);
  hmac.update(salt);
  hmac.update(path);
  return hmac.digest("base64url");
}
