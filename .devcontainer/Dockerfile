FROM mcr.microsoft.com/devcontainers/typescript-node:24

ARG FFMPEG_VERSION=7.0
ARG FFMPEG_RELEASE=autobuild-2024-08-31-12-50
ARG FFMPEG_BUILD=n7.0.2-6-g7e69129d2f

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      git-lfs \
      libimage-exiftool-perl \
      heif-thumbnailer \
      curl \
      xz-utils && \
    ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "arm64" ]; then FFMPEG_ARCH="linuxarm64"; \
    else FFMPEG_ARCH="linux64"; fi && \
    curl -fsSL https://github.com/BtbN/FFmpeg-Builds/releases/download/${FFMPEG_RELEASE}/ffmpeg-${FFMPEG_BUILD}-${FFMPEG_ARCH}-gpl-${FFMPEG_VERSION}.tar.xz \
      | tar -xJ --strip-components=1 -C /usr/local && \
    apt-get purge -y xz-utils && \
    apt-get autoremove -y && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
