import { generateUrl } from "@socialtip/asset-proxy-url-generator";
import { parseProcessingUrl } from "@socialtip/asset-proxy-url-parser";

import { CACHE_PROXY_URL, h2Fetch as fetch, URL_CONFIG } from "./setup.js";
import { SERVICE_URL, VIDEO_SOURCE_URL } from "./video-helpers.js";

const JAEGER_URL = process.env.JAEGER_URL ?? "http://localhost:16686";

interface JaegerSpan {
  operationName: string;
  tags: Array<{ key: string; type: string; value: string | number }>;
}

interface JaegerTrace {
  spans: JaegerSpan[];
}

async function getTraces(
  service: string,
  since: number,
  opts?: { limit?: number; tags?: Record<string, string> },
): Promise<JaegerTrace[]> {
  const params = new URLSearchParams({
    service,
    limit: String(opts?.limit ?? 10),
    start: String(since),
  });
  if (opts?.tags) params.set("tags", JSON.stringify(opts.tags));
  const res = await globalThis.fetch(`${JAEGER_URL}/api/traces?${params}`);
  const data = (await res.json()) as { data: JaegerTrace[] };
  return data.data ?? [];
}

function allSpans(traces: JaegerTrace[]): JaegerSpan[] {
  return traces.flatMap((t) => t.spans);
}

function spanAttrs(
  span: JaegerSpan,
): Record<string, string | number | undefined> {
  return Object.fromEntries(span.tags.map((t) => [t.key, t.value]));
}

describe("otel configuration", () => {
  it("health check requests are not traced on either port", async () => {
    const testStart = Date.now() * 1000;

    const parsed = parseProcessingUrl(
      `/insecure/w:128/plain/http://file-server/test-image.png@jpg`,
    );
    const res = await fetch(`${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`);
    await res.arrayBuffer();

    await globalThis.fetch("http://localhost:8082/health");
    await fetch(`${SERVICE_URL}/health`);

    const spans = await vi.waitFor(async () => {
      const traces = await getTraces("asset-proxy", testStart);
      expect(traces.length).toBeGreaterThan(0);
      return allSpans(traces);
    });

    const healthSpans = spans.filter((s) =>
      s.operationName.includes("/health"),
    );
    expect(healthSpans).toHaveLength(0);
  });

  it("inbound request span has descriptive name and Sentry-compatible attributes", async () => {
    const testStart = Date.now() * 1000;
    const marker = `otel-test-${Date.now()}`;

    const parsed = parseProcessingUrl(
      `/insecure/rs:fill:128:128/fr:15/ct:1/cb:${marker}/plain/${VIDEO_SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);
    const res = await fetch(`${SERVICE_URL}${urlPath}`);
    expect(res.status).toBe(200);
    await res.arrayBuffer();

    const requestSpan = await vi.waitFor(async () => {
      const traces = await getTraces("asset-proxy", testStart, {
        tags: { "url.path": urlPath },
      });
      const spans = allSpans(traces);
      const span = spans.find((s) =>
        s.tags.some(
          (t) => t.key === "otel.scope.name" && t.value === "@fastify/otel",
        ),
      );
      expect(span).toBeDefined();
      return span!;
    });

    const attrs = spanAttrs(requestSpan);

    // Span name remains "request" (from @fastify/otel)
    expect(requestSpan.operationName).toBe("request");

    // Sentry's OTLP ingestion uses sentry.description for the trace
    // explorer description column, not the OTEL span name.
    expect(attrs["sentry.description"]).toBe("GET /:signature/*");
  });

  it("cache.serveFromCache span has cache key as Sentry description", async () => {
    const testStart = Date.now() * 1000;

    const parsed = parseProcessingUrl(
      `/insecure/w:128/plain/http://file-server/test-image.png@jpg`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);

    // First request (cache miss) populates the cache
    const res1 = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res1.status).toBe(200);
    await res1.arrayBuffer();

    // Second request (cache hit) triggers serveFromCache
    const res2 = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res2.status).toBe(200);
    await res2.arrayBuffer();

    const cacheSpan = await vi.waitFor(async () => {
      const spans = allSpans(await getTraces("cache-proxy", testStart));
      const span = spans.find(
        (s) => s.operationName === "cache.serveFromCache",
      );
      expect(span).toBeDefined();
      return span!;
    });

    expect(cacheSpan.operationName).toBe("cache.serveFromCache");
    const attrs = spanAttrs(cacheSpan);
    expect(attrs["cache.key"]).toMatchInlineSnapshot(
      `"gBhXjyg-Ny3we6cqSRSatA2W_V37gXeWZU5hZmcEhaw/f:jpg/rs:fit:128:0/enc/NzMyYzQzZGJhYjk5ZDBlZtBKi-Id0FYxlGQ7-9wXDkM3s2zCBr3Da1CfeTUcMhYe03RhgH0EO99c6crVLSXM_A"`,
    );
  });
});
