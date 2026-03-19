# Monitoring

The proxy package ships with built-in [OpenTelemetry](https://opentelemetry.io/) instrumentation. The SDK is initialised in `packages/proxy/src/instrument.ts`, which is imported before any other module so that auto-instrumentation can patch HTTP and Express before they are loaded.

## What is collected

- **Traces** — automatic spans for every inbound HTTP request and outbound HTTP call (e.g. fetching source images, signing GCS URLs).
- **Logs** — Winston log records forwarded via the OTel logs pipeline (batched in production, simple in development).
- **Metrics** — standard Node.js runtime and HTTP metrics emitted via the OTLP metric exporter.

File-system instrumentation is disabled by default to reduce noise.

## Configuration

All configuration is done through the standard `OTEL_*` environment variables — no custom env vars are needed.

| Variable                             | Purpose                                                              | Example                                                               |
| ------------------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `OTEL_SERVICE_NAME`                  | Logical service name attached to all telemetry                       | `asset-proxy`                                                         |
| `OTEL_EXPORTER_OTLP_ENDPOINT`        | Base OTLP endpoint (used when signal-specific endpoints are not set) | `http://localhost:4318`                                               |
| `OTEL_EXPORTER_OTLP_HEADERS`         | Headers sent with all OTLP exports                                   | `x-sentry-auth:sentry sentry_key=abc123`                              |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Traces-specific OTLP endpoint                                        | `https://o123.ingest.us.sentry.io/api/456/integration/otlp/v1/traces` |
| `OTEL_EXPORTER_OTLP_TRACES_HEADERS`  | Headers for trace exports (defaults to `OTEL_EXPORTER_OTLP_HEADERS`) | `x-sentry-auth:sentry sentry_key=abc123`                              |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`   | Logs-specific OTLP endpoint                                          | `https://o123.ingest.us.sentry.io/api/456/integration/otlp/v1/logs`   |
| `OTEL_EXPORTER_OTLP_LOGS_HEADERS`    | Headers for log exports (defaults to `OTEL_EXPORTER_OTLP_HEADERS`)   | `x-sentry-auth:sentry sentry_key=abc123`                              |
| `OTEL_TRACES_SAMPLER`                | Sampling strategy                                                    | `parentbased_traceidratio`                                            |
| `OTEL_TRACES_SAMPLER_ARG`            | Sampler argument (e.g. ratio)                                        | `0.1`                                                                 |
| `OTEL_RESOURCE_ATTRIBUTES`           | Extra resource attributes                                            | `deployment.environment=production`                                   |

See the [OpenTelemetry environment variable spec](https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/) for the full list.

### Minimal example

```env
OTEL_SERVICE_NAME=asset-proxy
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

## Integrating with Sentry

Sentry supports ingesting OpenTelemetry data directly, so no Sentry-specific SDK is needed. You can find the OTLP configuration in your Sentry project under **Settings > Projects > (your project) > Client Keys (DSN) > OpenTelemetry (OTLP)**.

Sentry provides separate ingest endpoints for each signal type (traces, logs) but uses the same auth header for both:

```env
OTEL_SERVICE_NAME=asset-proxy
OTEL_EXPORTER_OTLP_ENDPOINT=https://o<ORG_ID>.ingest.us.sentry.io/api/<PROJECT_ID>/integration/otlp
OTEL_EXPORTER_OTLP_HEADERS=x-sentry-auth:sentry sentry_key=<SENTRY_KEY>

OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://o<ORG_ID>.ingest.us.sentry.io/api/<PROJECT_ID>/integration/otlp/v1/traces
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=https://o<ORG_ID>.ingest.us.sentry.io/api/<PROJECT_ID>/integration/otlp/v1/logs
```

Replace `<ORG_ID>`, `<PROJECT_ID>`, and `<SENTRY_KEY>` with values from the Sentry dashboard.

Once the proxy is running with these variables, traces will appear under **Performance** and logs under **Explore > Logs** in Sentry. No code changes are required.

### Further reading

- [Sentry OpenTelemetry setup guide](https://docs.sentry.io/platforms/javascript/guides/node/opentelemetry/)
- [Sentry OTLP ingest documentation](https://docs.sentry.io/product/explore/traces/otlp-ingest/)
