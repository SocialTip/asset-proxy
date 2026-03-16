# Build stage — use exact Node version matching .tool-versions
FROM node:24.13.0 AS build

RUN corepack enable

WORKDIR /app

COPY package.json yarn.lock tsconfig.json ./
RUN yarn install --immutable

COPY src/ ./src/
RUN yarn tsc

# Production stage — CUDA base for GPU acceleration
FROM nvidia/cuda:12.8.1-runtime-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive

# Pin Node.js version — must match .tool-versions (24.13.0)
ENV NODE_VERSION=24.13.0

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ffmpeg \
      ca-certificates \
      curl \
      xz-utils && \
    curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz \
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
