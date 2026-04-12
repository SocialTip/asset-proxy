import { FastifyOtelInstrumentation } from "@fastify/otel";
import type { Context } from "@opentelemetry/api";
import { SpanStatusCode } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import {
  BatchLogRecordProcessor,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type Span,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import { env } from "./env.js";

const environment = process.env.OTEL_ENVIRONMENT ?? "production";
const existing = process.env.OTEL_RESOURCE_ATTRIBUTES ?? "";
const envAttr = `deployment.environment.name=${environment}`;
process.env.OTEL_RESOURCE_ATTRIBUTES = existing
  ? `${existing},${envAttr}`
  : envAttr;

const sampleRate = env.TRACE_SAMPLE_RATE;

/**
 * Span processor that forwards all error traces and a configurable ratio of successful traces to the exporter. Uses the trace ID to make deterministic sampling decisions so all spans in a trace are either kept or dropped together.
 */
class SamplingSpanProcessor implements SpanProcessor {
  private readonly delegate: BatchSpanProcessor;

  constructor(exporter: SpanExporter) {
    this.delegate = new BatchSpanProcessor(exporter);
  }

  onStart(span: Span, parentContext: Context): void {
    this.delegate.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    const hasError = span.status.code === SpanStatusCode.ERROR;
    const traceId = span.spanContext().traceId;
    const hash = parseInt(traceId.slice(-8), 16) / 0x100000000;
    if (hasError || hash < sampleRate) {
      this.delegate.onEnd(span);
    }
  }

  async shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }

  async forceFlush(): Promise<void> {
    return this.delegate.forceFlush();
  }
}

export const fastifyOtelInstrumentation = new FastifyOtelInstrumentation({
  ignorePaths: "/health",
  requestHook: (span, request) => {
    // Sentry's OTLP ingestion maps the OTEL span name to span.name, but
    // span.description (shown in the trace explorer) comes from the
    // sentry.description attribute. Without this, the description is empty.
    const route = request.routeOptions.url ?? request.url;
    span.setAttribute("sentry.description", `${request.method} ${route}`);
  },
});

const sdk = new NodeSDK({
  spanProcessors: [new SamplingSpanProcessor(new OTLPTraceExporter())],
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
    }),
  ],
  logRecordProcessors: [
    process.env.NODE_ENV === "production"
      ? new BatchLogRecordProcessor(new OTLPLogExporter())
      : new SimpleLogRecordProcessor(new OTLPLogExporter()),
  ],
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fastify": { enabled: false },
      "@opentelemetry/instrumentation-http": {
        ignoreIncomingRequestHook: (req) => req.url === "/health",
      },
    }),
    fastifyOtelInstrumentation,
  ],
});

sdk.start();
