import { FastifyOtelInstrumentation } from "@fastify/otel";
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

const environment = process.env.OTEL_ENVIRONMENT ?? "production";
const existing = process.env.OTEL_RESOURCE_ATTRIBUTES ?? "";
const envAttr = `deployment.environment.name=${environment}`;
process.env.OTEL_RESOURCE_ATTRIBUTES = existing
  ? `${existing},${envAttr}`
  : envAttr;

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
  traceExporter: new OTLPTraceExporter(),
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
