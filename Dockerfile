# Builds a production image for the proxy package. Includes ffmpeg, exiftool, heif-thumbnailer, and optional NVIDIA GPU acceleration. Deployed to GCP Cloud Run via the CD workflow.

# Build stage — use exact Node version matching .tool-versions
FROM node:24.13.0 AS build

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/url-parser/package.json packages/url-parser/
COPY packages/proxy/package.json packages/proxy/
COPY packages/url-generator/package.json packages/url-generator/
RUN pnpm install --frozen-lockfile

COPY packages/ packages/
RUN pnpm --filter @socialtip/asset-proxy-url-parser build && pnpm --filter proxy build

# Production stage
FROM nvidia/cuda:12.8.1-runtime-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_VERSION=24.13.0

ENV LOG_LEVEL=info

ENV FFMPEG_VERSION=7.0
ENV FFMPEG_RELEASE=autobuild-2024-08-31-12-50
ENV FFMPEG_BUILD=n7.0.2-6-g7e69129d2f

# GPU is only used for video outputs (MP4/WebM). Image outputs — including
# video thumbnails extracted with vts — are always processed on CPU.
# Set SKIP_GPU=1 to fall back to CPU encoding for all video output.
ENV SKIP_GPU=
# Maximum concurrent GPU (NVENC) ffmpeg processes. Increase based on your
# GPU's NVENC session limit (consumer NVIDIA cards typically allow 3–5).
ENV GPU_CONCURRENCY=1
# Milliseconds to wait for a GPU slot before returning HTTP 429.
ENV GPU_ACQUIRE_TIMEOUT_MS=5000

ENV CACHE_BUCKET=
# When set, container will run in cache mode
ENV FORWARD_URL=

# Default quality for lossy formats (1–100). Per-request quality overrides this.
ENV QUALITY=80
# Format-specific default quality, e.g. "avif=63,webp=79".
# Overrides QUALITY for the specified formats.
ENV FORMAT_QUALITY=webp=79,avif=63,jpg=80
# Best format selection: automatically pick the smallest encoding among
# candidates (JPG, WebP, AVIF) based on image complexity.
ENV BEST_FORMAT_COMPLEXITY_THRESHOLD=5.5
ENV BEST_FORMAT_MAX_RESOLUTION=3
ENV BEST_FORMAT_BY_DEFAULT=
# Autoquality: automatically search for the lowest quality that meets a
# visual or size target. Method can be "none", "dssim", or "size".
ENV AUTOQUALITY_METHOD=none
ENV AUTOQUALITY_TARGET=
ENV AUTOQUALITY_MIN=
ENV AUTOQUALITY_MAX=
ENV AUTOQUALITY_ALLOWED_ERROR=
# Format-specific autoquality bounds, e.g. "avif=60,webp=70".
ENV AUTOQUALITY_FORMAT_MIN=
ENV AUTOQUALITY_FORMAT_MAX=

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      libimage-exiftool-perl \
      heif-thumbnailer \
      ca-certificates \
      curl \
      xz-utils && \
    ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "arm64" ]; then FFMPEG_ARCH="linuxarm64"; NODE_ARCH="linux-arm64"; \
    else FFMPEG_ARCH="linux64"; NODE_ARCH="linux-x64"; fi && \
    curl -fsSL https://github.com/BtbN/FFmpeg-Builds/releases/download/${FFMPEG_RELEASE}/ffmpeg-${FFMPEG_BUILD}-${FFMPEG_ARCH}-gpl-${FFMPEG_VERSION}.tar.xz \
      | tar -xJ --strip-components=1 -C /usr/local && \
    curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${NODE_ARCH}.tar.xz \
      | tar -xJ --strip-components=1 -C /usr/local && \
    apt-get purge -y xz-utils && \
    apt-get autoremove -y && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

COPY --from=build /app/packages/proxy/dist ./packages/proxy/dist/
COPY --from=build /app/packages/proxy/package.json ./packages/proxy/
COPY --from=build /app/packages/proxy/node_modules ./packages/proxy/node_modules/
COPY --from=build /app/packages/url-parser/dist ./packages/url-parser/dist/
COPY --from=build /app/packages/url-parser/package.json ./packages/url-parser/
COPY --from=build /app/packages/url-parser/node_modules ./packages/url-parser/node_modules/
COPY --from=build /app/node_modules ./node_modules/
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./

ENV OTEL_SERVICE_NAME=asset-proxy
ENV OTEL_EXPORTER_OTLP_ENDPOINT=
ENV OTEL_EXPORTER_OTLP_HEADERS=
ENV OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=
ENV OTEL_EXPORTER_OTLP_TRACES_HEADERS=${OTEL_EXPORTER_OTLP_HEADERS}
ENV OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=
ENV OTEL_EXPORTER_OTLP_LOGS_HEADERS=${OTEL_EXPORTER_OTLP_HEADERS}
# Must be always_on so all spans are recorded. The SamplingSpanProcessor
# in instrument.ts decides what gets exported based on TRACE_SAMPLE_RATE.
ENV OTEL_TRACES_SAMPLER=always_on
ENV OTEL_TRACES_SAMPLER_ARG=
# Fraction of traces to export (0–1). Error traces are always exported.
ENV TRACE_SAMPLE_RATE=0.1
ENV OTEL_RESOURCE_ATTRIBUTES=
ENV OTEL_ENVIRONMENT=production

# Main h2c port for asset processing requests.
ENV PORT=8080
# Separate HTTP/1.1 port for health checks. The main server speaks h2c only,
# which most load-balancer probes (Cloud Run, Kubernetes) do not support.
ENV HEALTH_PORT=8082
EXPOSE 8080
EXPOSE 8082

HEALTHCHECK --interval=30s --timeout=5s \
  CMD curl -f http://localhost:8082/health || exit 1

ARG BUILD_VERSION="<unset>"
ENV BUILD_VERSION=${BUILD_VERSION}

CMD ["node", "--import", "./packages/proxy/dist/instrument.js", "packages/proxy/dist/index.js"]
