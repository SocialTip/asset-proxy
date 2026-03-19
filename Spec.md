# Asset Proxy — Technical Specification

## Overview

An asset processing proxy compatible with the [imgproxy](https://imgproxy.net/) API. The service accepts an imgproxy-format URL, fetches the source asset, applies the requested transformations, and streams the result back to the client.

The service should not implement image or video processing directly. It should delegate to an external tool such as ffmpeg.

## Goals

- Support video processing (resizing at minimum) in addition to image processing
- GPU-accelerated video encoding on GCP Cloud Run GPUs
- Compatibility with as much of the [imgproxy API](https://docs.imgproxy.net/usage/processing) as possible — same URL format, signing, encryption, and processing options
- Astro image service plugin for client-side integration
- Packaged as a Docker image

## Non-goals

- Being a strict superset of imgproxy — full feature parity is not required, but the API surface should be compatible where supported
- Supporting GPU vendors other than those available on GCP

## URL Format

```
/<signature>/<processing_options>/plain/<source_url>
/<signature>/<processing_options>/enc/<encrypted_source_url>
```

The URL has three parts:

1. **Signature** — always required as a path segment, but only validated when signing is enabled
2. **Processing options** — as defined by the [imgproxy processing docs](https://docs.imgproxy.net/usage/processing)
3. **Source URL** — either plaintext (after `/plain/`) or AES-256-CBC encrypted (after `/enc/`)

### URL Signing

The first path segment is the signature. It covers everything after it (the processing options and source URL). Compatible with the [imgproxy signing scheme](https://docs.imgproxy.net/usage/signing_url):

1. Concatenate: `salt + path` (where `path` is everything after the signature segment, including the leading `/`)
2. Compute HMAC-SHA256 using the signing key
3. Encode with URL-safe Base64

When `SIGNING_KEY` and `SIGNING_SALT` are configured, all requests must carry a valid signature. When they are not configured, the signature segment is still structurally required but may contain any value (e.g. `unsafe`, `_`).

### Source URL Encryption

Source URLs may be encrypted to prevent exposure in logs and CDN caches. Compatible with the [imgproxy encryption scheme](https://docs.imgproxy.net/usage/encrypting_source_url):

1. Pad the plaintext URL with PKCS#7 to 16-byte alignment
2. Generate a random 16-byte IV
3. Encrypt with AES-256-CBC
4. Concatenate: `IV + ciphertext`
5. Encode with URL-safe Base64

Requires `SOURCE_URL_ENCRYPTION_KEY` (32-byte hex-encoded AES-256 key).

## Image Processing

The service aims to support [imgproxy processing options](https://docs.imgproxy.net/usage/processing) for image sources where applicable. Source format detection is automatic.

## Video Processing

Video processing uses its own set of processing options, separate from imgproxy's image options. Spatial options (resize, crop, etc.) are shared, but temporal and encoding options are video-specific.

### Frame rate

```
framerate:<fps>
```

Shorthand: `fr:<fps>`

Sets the output frame rate. When omitted, the source frame rate is preserved.

### Trim

```
trim:<duration_seconds>
```

Shorthand: `tr:<duration_seconds>`

Cuts the video to the first N seconds. When omitted, the full duration is preserved.

### Output format

Video output is limited to:

- **MP4** — H.264 or H.265 encoding
- **WebM** — VP9 encoding

The output format is specified via the `@<extension>` suffix on the URL (e.g. `@mp4`, `@webm`). When omitted, the default is MP4 with H.264.

Video output is streamed where possible, allowing the response to begin before the full output is available. Audio tracks are passed through without re-encoding.

## Google Cloud Storage Source URLs

The service supports `gs://` URLs as source URLs (e.g. `gs://my-bucket/path/to/video.mp4`). When a `gs://` source URL is encountered, the service fetches the object using the Google Cloud Storage SDK, authenticating via Application Default Credentials. This allows the service to inherit the IAM roles assigned to its Cloud Run service account without requiring any additional configuration.

`gs://` URLs are subject to the same origin whitelist rules as HTTP URLs.

## Source Origin Whitelist

The service must restrict which origins it will fetch source assets from. When `ALLOWED_ORIGINS` is configured, the service rejects any request whose source URL does not match one of the listed origins. This prevents the proxy from being used as an open relay to fetch and process arbitrary remote content.

Origins are matched against the scheme and host of the source URL (e.g. `https://cdn.example.com`). If `ALLOWED_ORIGINS` is not set, all origins are permitted.

## GPU Acceleration

The service supports GPU acceleration for video processing (hardware decoding, scaling, and encoding). At startup — before the HTTP server begins accepting requests — the service probes for GPU availability. If the probe fails and `SKIP_GPU` is not set, the process exits with an error. When `SKIP_GPU` is set, the service falls back to CPU encoding.

The Docker image supports GPU-accelerated rendering on GCP Cloud Run.

## Configuration

All configuration is via environment variables.

| Variable                           | Default                               | Description                                                                                                                                               |
| ---------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                             | `8080`                                | Server listen port                                                                                                                                        |
| `SKIP_GPU`                         | —                                     | Set to skip GPU acceleration and fall back to CPU encoding                                                                                                |
| `SIGNING_KEY`                      | —                                     | Hex-encoded HMAC-SHA256 key for URL signature verification                                                                                                |
| `SIGNING_SALT`                     | —                                     | Hex-encoded salt for URL signing. Required when `SIGNING_KEY` is set                                                                                      |
| `ALLOWED_ORIGINS`                  | —                                     | Comma-separated list of allowed source URL origins (e.g. `https://cdn.example.com,https://storage.googleapis.com`). When unset, all origins are permitted |
| `BEST_FORMAT_COMPLEXITY_THRESHOLD` | `5.5`                                 | Entropy threshold for best format: below = lossless preferred, at/above = lossy preferred                                                                 |
| `BEST_FORMAT_MAX_RESOLUTION`       | `0`                                   | When > 0, skip best format testing for images exceeding this megapixel count                                                                              |
| `BEST_FORMAT_BY_DEFAULT`           | —                                     | Set to use best format selection automatically when no explicit output format is specified                                                                |
| `CACHE_CONTROL`                    | `public, max-age=31536000, immutable` | Value of the `Cache-Control` response header                                                                                                              |
| `SOURCE_URL_ENCRYPTION_KEY`        | —                                     | 32-byte hex-encoded AES-256-CBC key (64 hex characters) for decrypting `/enc/` source URLs                                                                |

Environment variables are validated at startup. The process exits immediately with a descriptive error if validation fails.

## Caching

The service sets a `Cache-Control` header on responses, configurable via `CACHE_CONTROL`. It is expected to sit behind a CDN.

## Node.js Client

<!-- TODO: implement as a separate package (e.g. packages/client) -->

A standalone Node.js package for generating asset proxy URLs. Handles URL signing, source URL encryption, and processing option serialisation. This package has no dependency on the service itself and can be used in any Node.js environment.

## Astro Image Service Plugin

<!-- TODO: implement as a separate package (e.g. packages/astro) on top of the Node.js client -->

An `astro-integration` package provides an [Astro image service](https://docs.astro.build/en/reference/image-service-reference/) backed by this proxy, built on top of the Node.js client. The plugin:

- Implements `getURL()` to generate signed proxy URLs for `<Image>` and `getImage()` calls
- Handles source URL encryption when configured

## Observability

- Structured JSON logging
- OpenTelemetry integration for traces and metrics
- Health check endpoint (`/health`)
