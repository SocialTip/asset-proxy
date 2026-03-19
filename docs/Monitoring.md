# Monitoring

The proxy package ships with built-in [OpenTelemetry](https://opentelemetry.io/) instrumentation. The SDK is initialised in `packages/proxy/src/instrument.ts`, which is imported before any other module.

## What is collected

- **Traces** — automatic spans for every inbound HTTP request and outbound HTTP call (e.g. fetching source images, signing GCS URLs).
- **Metrics** — standard Node.js runtime and HTTP metrics emitted via the OTLP metric exporter.

File-system instrumentation is disabled by default to reduce noise.

## Configuration

All configuration is done through the standard `OTEL_*` environment variables — no custom env vars are needed.

| Variable                      | Purpose                                        | Example                             |
| ----------------------------- | ---------------------------------------------- | ----------------------------------- |
| `OTEL_SERVICE_NAME`           | Logical service name attached to all telemetry | `asset-proxy`                       |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP collector endpoint                        | `http://localhost:4318`             |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | Transport protocol (default `http/protobuf`)   | `http/protobuf`                     |
| `OTEL_TRACES_SAMPLER`         | Sampling strategy                              | `parentbased_traceidratio`          |
| `OTEL_TRACES_SAMPLER_ARG`     | Sampler argument (e.g. ratio)                  | `0.1`                               |
| `OTEL_RESOURCE_ATTRIBUTES`    | Extra resource attributes                      | `deployment.environment=production` |

See the [OpenTelemetry environment variable spec](https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/) for the full list.

### Minimal example

```env
OTEL_SERVICE_NAME=asset-proxy
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

## Integrating with Sentry

Sentry supports ingesting OpenTelemetry data directly, so no Sentry-specific SDK is needed. Point the OTLP exporter at Sentry's ingest endpoint and authenticate with your DSN.

### 1. Get your project's DSN

Find it under **Settings > Projects > (your project) > Client Keys (DSN)** in the Sentry dashboard. The DSN looks like:

```
https://<PUBLIC_KEY>@o<ORG_ID>.ingest.sentry.io/<PROJECT_ID>
```

### 2. Set the environment variables

```env
OTEL_SERVICE_NAME=asset-proxy
OTEL_EXPORTER_OTLP_ENDPOINT=https://o<ORG_ID>.ingest.sentry.io
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS=Authorization=DSN <your-dsn>
```

Replace `<ORG_ID>` and `<your-dsn>` with values from your Sentry project.

### 3. Verify

Once the proxy is running with the above variables, traces and metrics will appear in Sentry under **Performance**. No code changes are required.

### Further reading

- [Sentry OpenTelemetry setup guide](https://docs.sentry.io/platforms/javascript/guides/node/opentelemetry/)
- [Sentry OTLP ingest documentation](https://docs.sentry.io/product/explore/traces/otlp-ingest/)
