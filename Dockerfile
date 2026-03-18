# Build stage — use exact Node version matching .tool-versions
FROM node:24.13.0 AS build

RUN corepack enable

WORKDIR /app

COPY package.json yarn.lock tsconfig.json ./
RUN yarn install --immutable

COPY src/ ./src/
RUN yarn tsc

# Production stage
FROM nvidia/cuda:12.8.1-runtime-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_VERSION=24.13.0
ENV FFMPEG_VERSION=7.0
ENV FFMPEG_RELEASE=autobuild-2024-08-31-12-50
ENV FFMPEG_BUILD=n7.0.2-6-g7e69129d2f
ENV SKIP_GPU=

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

WORKDIR /app

COPY --from=build /app/dist ./dist/
COPY --from=build /app/node_modules ./node_modules/
COPY --from=build /app/package.json ./

ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s \
  CMD curl -f http://localhost:8080/health || exit 1

CMD ["node", "dist/index.js"]
