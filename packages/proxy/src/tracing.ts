import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";

export const tracer = trace.getTracer("asset-proxy");

export function recordException(span: Span, err: unknown): void {
  span.recordException(
    err instanceof Error ? err : new Error("Span failed", { cause: err }),
  );
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: err instanceof Error ? err.message : String(err),
  });
}

export async function withSpan<T>(
  name: string,
  attrs: Record<string, string | number | boolean | undefined>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined) span.setAttribute(k, v);
    }
    try {
      const result = await fn(span);
      span.end();
      return result;
    } catch (err) {
      recordException(span, err);
      span.end();
      throw err;
    }
  });
}
