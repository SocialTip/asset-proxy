import type { Storage } from "@google-cloud/storage";

export interface SourceMetadataResult {
  contentType?: string;
  contentLength?: number;
}

const HEAD_TIMEOUT_MS = 5_000;

/**
 * Returns a memoised thunk that lazily fetches source file metadata. Uses the GCS API for `gs://` URLs and a HEAD request for HTTP(S) URLs.
 */
export function createSourceMetadata(
  sourceUrl: string,
  gcs: Storage,
): () => Promise<SourceMetadataResult> {
  let promise: Promise<SourceMetadataResult> | null = null;
  return () => {
    promise ??= sourceUrl.startsWith("gs://")
      ? fetchGcs(sourceUrl, gcs)
      : fetchHead(sourceUrl);
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
    const [metadata] = await gcs
      .bucket(bucket)
      .file(objectPath)
      .getMetadata();
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
