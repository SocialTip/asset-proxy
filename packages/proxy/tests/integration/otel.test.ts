import { generateUrl } from "@socialtip/asset-proxy-url-generator";
import { parseProcessingUrl } from "@socialtip/asset-proxy-url-parser";

import { h2Fetch as fetch, URL_CONFIG } from "./setup.js";
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
  limit = 10,
): Promise<JaegerTrace[]> {
  const res = await globalThis.fetch(
    `${JAEGER_URL}/api/traces?service=${service}&limit=${limit}&start=${since}`,
  );
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

    const parsed = parseProcessingUrl(
      `/insecure/rs:fill:128:128/fr:15/ct:1/plain/${VIDEO_SOURCE_URL}`,
    );
    const url = `${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    await res.arrayBuffer();

    const requestSpan = await vi.waitFor(async () => {
      const spans = allSpans(await getTraces("asset-proxy", testStart));
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

    // sentry.origin must start with "auto" so Sentry infers the description from HTTP attributes rather than using the raw span name
    expect(attrs["sentry.origin"]).toBe("auto.http.otel.fastify");

    // Sentry constructs the description as "{method} {http.route}" when http.route is present
    expect(attrs["http.request.method"]).toBe("GET");
    expect(attrs["http.route"]).toBe("/:signature/*");
  });
});
