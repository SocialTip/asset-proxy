import type { Http2Server } from "node:http2";
import { Readable } from "node:stream";

import {
  HTTPError,
  parseProcessingUrl,
  verifySignature,
} from "@socialtip/asset-proxy-url-parser";
import contentDisposition from "content-disposition";
import type {
  FastifyReply,
  FastifyRequest,
  RouteGenericInterface,
} from "fastify";
import parseRange from "range-parser";

import { cacheControlFor } from "./cache-control.js";
import { env } from "./env.js";
import { assertOriginAllowed } from "./resolve-source.js";
import { tracer } from "./tracing.js";

type ParsedUrl = ReturnType<typeof parseProcessingUrl>;
type AppRequest = FastifyRequest<RouteGenericInterface, Http2Server>;
type AppReply = FastifyReply<RouteGenericInterface, Http2Server>;

// ponytail: fixed cap so every passthrough response finishes well inside the load balancer's 30s response timeout; lower it if slow clients still time out.
const MAX_RAW_RANGE_BYTES = 8 * 1024 * 1024;

const PASSTHROUGH_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
];

const FORMAT_EXTENSIONS: Record<string, string> = {
  mp4: ".mp4",
  webm: ".webm",
  jpg: ".jpg",
  png: ".png",
  webp: ".webp",
  avif: ".avif",
  gif: ".gif",
};

/**
 * Verifies the signature of a processing URL path against the configured keys, parses it, and checks its source origin and `expires` claim.
 *
 * Shared by the processing proxy and the cache proxy's raw passthrough, so both refuse the same URLs.
 */
export function parseSignedUrl(path: string): ParsedUrl {
  const pathAfterSignature = verifySignature(path, {
    signingKey: env.SIGNING_KEY,
    signingSalt: env.SIGNING_SALT,
  });
  const parsed = parseProcessingUrl(pathAfterSignature, {
    encryptionKey: env.SOURCE_URL_ENCRYPTION_KEY,
  });

  assertOriginAllowed(parsed.sourceUrl, env.ALLOWED_ORIGINS);

  if (parsed.expires && Date.now() / 1000 > parsed.expires) {
    throw new HTTPError("URL has expired", { code: "NOT_FOUND" });
  }

  return parsed;
}

export function setContentDisposition(
  reply: AppReply,
  parsed: ParsedUrl,
  outputFormat?: string,
): void {
  let filename = parsed.filename;
  if (filename && outputFormat) {
    const ext = FORMAT_EXTENSIONS[outputFormat];
    if (ext) filename = filename.replace(/\.[^.]+$/, ext);
  }
  if (!filename && outputFormat) {
    filename = `image${FORMAT_EXTENSIONS[outputFormat] ?? ""}`;
  }
  const type = parsed.returnAttachment ? "attachment" : "inline";
  reply.header(
    "Content-Disposition",
    contentDisposition(filename ?? undefined, { type }),
  );
}

/**
 * Streams the source unchanged, honouring a single `Range` (capped at 8 MiB) and `If-Range`, so a CDN can fill large objects in chunks.
 *
 * Used by the processing proxy for `raw` and `skip_processing`, and by the cache proxy for `raw`.
 */
export async function servePassthrough(
  request: AppRequest,
  reply: AppReply,
  parsed: ParsedUrl,
  sourceUrl: string,
  getSourceMetadata: () => Promise<{ contentLength?: number }>,
): Promise<void> {
  const headers: Record<string, string> = {};
  const { range, "if-range": ifRange } = request.headers;
  const { contentLength: size } = await getSourceMetadata();
  if (range && size) {
    const ranges = parseRange(size, range, { combine: true });
    if (ranges === -1 || ranges === -2 || ranges.length !== 1) {
      reply.code(416);
      reply.header("Content-Range", `bytes */${size}`);
      return reply.send();
    }
    const { start, end } = ranges[0];
    headers.range = `bytes=${start}-${Math.min(end, start + MAX_RAW_RANGE_BYTES - 1)}`;
    if (typeof ifRange === "string") headers["if-range"] = ifRange;
  }
  const response = await fetch(sourceUrl, { headers });
  if (!response.ok) {
    throw new HTTPError(`Failed to fetch source: ${response.status}`, {
      code: "BAD_REQUEST",
    });
  }
  reply.code(response.status);
  for (const name of PASSTHROUGH_HEADERS) {
    const value = response.headers.get(name);
    if (value) reply.header(name, value);
  }
  // Cloud CDN only fills in chunks when range responses advertise support, which some origins (e.g. nginx) omit on 206.
  if (response.status === 206) reply.header("Accept-Ranges", "bytes");
  reply.header("Cache-Control", cacheControlFor(parsed.expires));
  setContentDisposition(reply, parsed);
  const responseSpan = tracer.startSpan("response.stream");
  const raw = Readable.fromWeb(
    response.body as import("node:stream/web").ReadableStream,
  );
  raw.on("end", () => responseSpan.end());
  raw.on("error", () => responseSpan.end());
  return reply.send(raw);
}
