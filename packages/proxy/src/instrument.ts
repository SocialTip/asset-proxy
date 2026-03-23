import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { Resource } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";

const environment = process.env.OTEL_ENVIRONMENT ?? "production";

const sdk = new NodeSDK({
  resource: new Resource({
    "deployment.environment.name": environment,
  }),
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
  instrumentations: [getNodeAutoInstrumentations({})],
});

sdk.start();
