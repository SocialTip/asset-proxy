import type { Storage } from "@google-cloud/storage";
import { LRUCache } from "lru-cache";

export interface SourceMetadataResult {
  contentType?: string;
  contentLength?: number;
}

const HEAD_TIMEOUT_MS = 5_000;

const cache = new LRUCache<string, Promise<SourceMetadataResult>>({
  max: 1000,
  ttl: 60 * 1000,
});

/** Clear the metadata cache. Exposed for testing only. */
export function clearSourceMetadataCache(): void {
  cache.clear();
}

/**
 * Returns a thunk that lazily fetches source file metadata. Uses the GCS API for `gs://` URLs and a HEAD request for HTTP(S) URLs.
 *
 * Results are cached across requests for a minute, because ranged playback asks for the same source's metadata on every chunk. Empty results (failed lookups) are not cached.
 */
export function createSourceMetadata(
  sourceUrl: string,
  gcs: Storage,
): () => Promise<SourceMetadataResult> {
  return () => {
    let promise = cache.get(sourceUrl);
    if (!promise) {
      promise = sourceUrl.startsWith("gs://")
        ? fetchGcs(sourceUrl, gcs)
        : fetchHead(sourceUrl);
      cache.set(sourceUrl, promise);
      promise.then((result) => {
        if (!result.contentType && !result.contentLength) {
          cache.delete(sourceUrl);
        }
      });
    }
    return promise;
  };
}

async function fetchGcs(
  sourceUrl: string,
  gcs: Storage,
): Promise<SourceMetadataResult> {
  const withoutScheme = sourceUrl.slice("gs://".length);
  const slashIdx = withoutScheme.indexOf("/");
  if (slashIdx === -1) return {};
  const bucket = withoutScheme.slice(0, slashIdx);
  const objectPath = withoutScheme.slice(slashIdx + 1);
  try {
    const [metadata] = await gcs.bucket(bucket).file(objectPath).getMetadata();
    return {
      contentType: (metadata.contentType as string) ?? undefined,
      contentLength: metadata.size ? Number(metadata.size) : undefined,
    };
  } catch {
    return {};
  }
}

async function fetchHead(sourceUrl: string): Promise<SourceMetadataResult> {
  try {
    const response = await fetch(sourceUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    });
    if (!response.ok) return {};
    const cl = response.headers.get("content-length");
    return {
      contentType: response.headers.get("content-type") ?? undefined,
      contentLength: cl ? parseInt(cl, 10) : undefined,
    };
  } catch {
    return {};
  }
}
