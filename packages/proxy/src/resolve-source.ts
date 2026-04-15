import type { Storage } from "@google-cloud/storage";
import { HTTPError } from "@socialtip/asset-proxy-url-parser";

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

export async function resolveGcsUrl(
  gsUrl: string,
  gcs: Storage,
): Promise<string> {
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
          expires: Date.now() + 15 * 60 * 1000,
        });

      return signedUrl;
    },
  );
}
