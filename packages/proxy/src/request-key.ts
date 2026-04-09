import { createHash } from "node:crypto";

/** Short hash of the request path for log correlation between cache proxy and processor. */
export function requestKey(requestPath: string): string {
  return createHash("md5").update(requestPath).digest("hex").slice(0, 12);
}
