import type { Storage } from "@google-cloud/storage";
import { HTTPError } from "@socialtip/asset-proxy-url-parser";
import { LRUCache } from "lru-cache";

import type { Env } from "./env.js";
import { withSpan } from "./tracing.js";

export function assertOriginAllowed(
  sourceUrl: string,
  allowedOrigins: Env["ALLOWED_ORIGINS"],
): void {
  if (!allowedOrigins) return;

  const origin = extractOrigin(sourceUrl);
  if (!allowedOrigins.has(origin)) {
    throw new HTTPError(`Origin not allowed: ${origin}`, {
      code: "FORBIDDEN",
    });
  }
}

function extractOrigin(sourceUrl: string): string {
  if (sourceUrl.startsWith("gs://")) {
    const bucket = sourceUrl.slice("gs://".length).split("/")[0];
    return `gs://${bucket}`;
  }
  const url = new URL(sourceUrl);
  return url.origin;
}

const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

// Reused for 10 of the URL's 15 minutes, so a fetch started from a cached URL still has at least 5 minutes left.
const signedUrls = new LRUCache<string, Promise<string>>({
  max: 1000,
  ttl: 10 * 60 * 1000,
});

/** Clear the signed URL cache. Exposed for testing only. */
export function clearSignedUrlCache(): void {
  signedUrls.clear();
}

/**
 * Resolves a `gs://` URL to a V4 signed HTTPS URL. Signed URLs are cached, because on Cloud Run each signature is an IAM `signBlob` call and ranged playback resolves the same object for every chunk.
 */
export function resolveGcsUrl(gsUrl: string, gcs: Storage): Promise<string> {
  let promise = signedUrls.get(gsUrl);
  if (!promise) {
    promise = signGcsUrl(gsUrl, gcs);
    signedUrls.set(gsUrl, promise);
    promise.catch(() => signedUrls.delete(gsUrl));
  }
  return promise;
}

async function signGcsUrl(gsUrl: string, gcs: Storage): Promise<string> {
  const withoutScheme = gsUrl.slice("gs://".length);
  const slashIdx = withoutScheme.indexOf("/");
  if (slashIdx === -1) {
    throw new HTTPError("Invalid gs:// URL: missing object path", {
      code: "BAD_REQUEST",
    });
  }

  const bucket = withoutScheme.slice(0, slashIdx);
  const objectPath = withoutScheme.slice(slashIdx + 1);

  return withSpan(
    "gcs.getSignedUrl",
    { "gcs.bucket": bucket, "gcs.object": objectPath },
    async () => {
      const [signedUrl] = await gcs
        .bucket(bucket)
        .file(objectPath)
        .getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + SIGNED_URL_TTL_MS,
        });

      return signedUrl;
    },
  );
}
