import { env } from "./env.js";

/**
 * Returns the Cache-Control header value for a successful response. When the URL has an `expires` claim, caps `max-age` to the remaining TTL and drops `immutable` so edge caches stop serving the response once the signed URL is no longer valid. Otherwise returns the configured `CACHE_CONTROL` default.
 */
export function cacheControlFor(expires?: number): string {
  if (!expires) return env.CACHE_CONTROL;
  const ttl = Math.max(0, Math.floor(expires - Date.now() / 1000));
  return `public, max-age=${ttl}`;
}
