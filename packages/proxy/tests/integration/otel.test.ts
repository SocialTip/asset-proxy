import { generateUrl } from "@socialtip/asset-proxy-url-generator";
import { parseProcessingUrl } from "@socialtip/asset-proxy-url-parser";

import { h2Fetch as fetch, URL_CONFIG } from "./setup.js";
import { SERVICE_URL } from "./video-helpers.js";

const JAEGER_URL = process.env.JAEGER_URL ?? "http://localhost:16686";

interface JaegerSpan {
  operationName: string;
  tags: Array<{ key: string; value: string | number }>;
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

describe("otel configuration", () => {
  it("health check requests are not traced on either port", async () => {
    const testStart = Date.now() * 1000;

    // Make a normal request first so traces are flowing
    const parsed = parseProcessingUrl(
      `/insecure/w:128/plain/http://file-server/test-image.png@jpg`,
    );
    const res = await fetch(`${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`);
    await res.arrayBuffer();

    // Hit health on both HTTP/1.1 port and h2c main port
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
});
