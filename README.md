# asset-proxy

An image and video processing service with an [imgproxy](https://docs.imgproxy.net/usage/processing)-compatible URL API. Uses ffmpeg (with optional NVIDIA GPU acceleration) for the vast majority of processing, and sharp for certain image-specific operations.

## URL format

```
/<signature>/<options>/plain/<source_url>[@<format>]
/<signature>/<options>/enc/<encrypted_source_url>[@<format>]
```

The signature segment is always required structurally. When `SIGNING_KEY` and `SIGNING_SALT` are not set, any value is accepted (e.g. `_`). When they are set, the signature is validated as described below.

**Examples:**

```
/_/resize:fill:480:360/plain/https://example.com/my-video.mp4
/_/resize:fill:480:360/fr:30/tr:10/plain/https://example.com/my-video.mp4@webm
/_/w:300/q:80/plain/https://example.com/photo.jpg@webp
/oKfUtW34Dvo.../resize:fill:480:360/enc/dGhpcyBpcyBhIGJhc2U2NC...
```

The service automatically detects whether to use image or video processing based on the output format suffix and source URL extension.

### Processing options

Options are path segments between the signature and the source URL. For the full list of available options, see the processing docs:

- **[Image Processing](docs/Image.md)** — resize, crop, quality, filters, format-specific encoding options, and more
- **[Video Processing](docs/Video.md)** — resize, crop, framerate, cut, mute, thumbnail extraction, GPU acceleration, and more

### Common options

The following options apply equally to both image and video processing:

#### Skip Processing — `skip_processing:<ext1>:<ext2>:...` (shorthand `skp`)

Skip all processing when the source file extension matches one of the listed formats. The source is fetched and returned as-is. Example: `skp:jpg:png` skips processing for JPEG and PNG sources.

#### Raw — `raw:1`

Return the source without any processing. The proxy fetches the source and passes it through unchanged, preserving the original content type.

#### Cache Buster — `cache_buster:<value>` (shorthand `cb`)

An ignored value used to differentiate CDN cache keys. The proxy does not use this value — it exists purely to allow cache invalidation by changing the URL. Example: `cb:v2`.

#### Expires — `expires:<timestamp>` (shorthand `exp`)

Unix timestamp after which the URL returns 404 Not Found. Used to create time-limited URLs. Example: `exp:1700000000`.

#### Filename — `filename:<name>` (shorthand `fn`)

Set the `Content-Disposition` header filename. When combined with `return_attachment`, triggers a download with the given filename. Example: `fn:photo.jpg`.

#### Return Attachment — `return_attachment:1` (shorthand `att`)

Set `Content-Disposition: attachment` on the response, prompting browsers to download rather than display inline. Combine with `filename` to control the download name.

#### Fallback Image URL — `fallback_image_url:<base64url>` (shorthand `fiu`)

Base64url-encoded URL to redirect to when processing fails. If the source cannot be fetched or processing errors out, the proxy responds with a 302 redirect to the decoded fallback URL instead of an error. Example: `fiu:aHR0cHM6Ly9leGFtcGxlLmNvbS9mYWxsYmFjay5qcGc`.

#### Hashsum — `hashsum:<type>:<hex_digest>` (shorthand `hs`)

Verify the source file's integrity by computing a checksum and comparing it to the expected digest. The type is any algorithm supported by Node.js `crypto.createHash` (e.g. `sha256`, `md5`). Returns 422 if the hash does not match. Example: `hs:sha256:abc123...`.

#### Max Source Resolution — `max_src_resolution:<megapixels>` (shorthand `msr`)

Reject the source if its resolution exceeds the given megapixel limit. Uses ffprobe to detect source dimensions before processing. Returns 422 if exceeded. Can also be set via the `MAX_SRC_RESOLUTION` env var (0 = unlimited). Example: `msr:25`.

#### Max Source File Size — `max_src_file_size:<bytes>` (shorthand `msfs`)

Reject the source if its file size exceeds the given byte limit. Checks the `Content-Length` header via a HEAD request before downloading. Returns 422 if exceeded. Can also be set via the `MAX_SRC_FILE_SIZE` env var (0 = unlimited). Example: `msfs:10485760` (10MB).

#### Max Animation Frames — `max_animation_frames:<count>` (shorthand `maf`)

Limit the number of frames in video thumbnail animations (`vta`). Returns 422 if the requested frame count exceeds the limit. Can also be set via the `MAX_ANIMATION_FRAMES` env var (0 = unlimited). Example: `maf:100`.

#### Max Animation Frame Resolution — `max_animation_frame_resolution:<megapixels>` (shorthand `mafr`)

Limit the resolution of individual animation frames. Returns 422 if the frame width × height exceeds the megapixel limit. Can also be set via the `MAX_ANIMATION_FRAME_RESOLUTION` env var (0 = unlimited). Example: `mafr:5`.

#### Max Result Dimension — `max_result_dimension:<pixels>` (shorthand `mrd`)

Limit the maximum width or height of the output. Returns 422 if either the requested width or height exceeds the limit. Can also be set via the `MAX_RESULT_DIMENSION` env var (0 = unlimited). Example: `mrd:4096`.

### Source URLs

#### Plain HTTP(S) URLs

Use the `/plain/` prefix: `/plain/https://example.com/video.mp4`

#### Google Cloud Storage (`gs://`)

Use `gs://` URLs directly: `/plain/gs://my-bucket/path/to/video.mp4`

Authenticated via Application Default Credentials. A temporary signed URL is generated for ffmpeg.

#### Encrypted source URLs

Source URLs can be encrypted using AES-256-CBC, following the [imgproxy encrypted source URL format](https://docs.imgproxy.net/usage/encrypting_source_url):

1. Pad the source URL with PKCS#7 to 16-byte alignment
2. Generate a 16-byte IV
3. Encrypt with AES-256-CBC using the key and IV
4. Concatenate: `IV + ciphertext`
5. Encode with URL-safe Base64

Use the `/enc/` prefix instead of `/plain/` in the URL path. Requires `SOURCE_URL_ENCRYPTION_KEY` to be set.

### URL signing

URLs can be signed with HMAC-SHA256, following the [imgproxy URL signing format](https://docs.imgproxy.net/usage/signing_url). The signature is the first path segment and covers everything after it:

1. Take the path after the signature (e.g. `/resize:fill:480:360/plain/https://example.com/video.mp4`)
2. Compute HMAC-SHA256 of: `salt + path`
3. Encode the digest with URL-safe Base64

When `SIGNING_KEY` and `SIGNING_SALT` are not set, the signature segment is still required but any value is accepted.

## Info endpoint

The `/info/` endpoint returns JSON metadata about a source asset without processing it. See [Metadata](docs/Metadata.md) for full documentation.

## URL generator package

The `@socialtip/asset-proxy-url-generator` npm package generates asset-proxy-compatible URL paths programmatically. It uses the same types as the server's URL parser.

```bash
npm install @socialtip/asset-proxy-url-generator
```

```ts
import { generateUrl } from "@socialtip/asset-proxy-url-generator";

const url = generateUrl({
  sourceUrl: "https://example.com/photo.jpg",
  outputFormat: "webp",
  resize: { type: "fill", width: 480, height: 360 },
  quality: 80,
});
// => /_/rs:fill:480:360/q:80/plain/https://example.com/photo.jpg@webp
```

Encrypted source URLs and signed URLs are supported via the optional second argument:

```ts
const url = generateUrl(
  { sourceUrl: "https://example.com/photo.jpg", outputFormat: "webp" },
  {
    encryptionKey: "0123456789abcdef...", // hex-encoded 32-byte key
    signingKey: "...", // hex-encoded HMAC key
    signingSalt: "...", // hex-encoded salt
  },
);
```

## Project structure

This repository is a pnpm monorepo with three packages:

| Package                                | Path                     | Published | Description                                                                        |
| -------------------------------------- | ------------------------ | --------- | ---------------------------------------------------------------------------------- |
| `@socialtip/asset-proxy-url-parser`    | `packages/url-parser`    | Yes       | Shared URL schema, parsing, signature verification/generation, and encryption      |
| `@socialtip/asset-proxy-url-generator` | `packages/url-generator` | Yes       | Generates asset-proxy-compatible URL paths with encryption and signing             |
| `proxy`                                | `packages/proxy`         | No        | The image/video processing service (Express + ffmpeg + sharp), deployed via Docker |

## Development

Requires [asdf](https://asdf-vm.com/) with the `nodejs` plugin.

```bash
asdf install        # installs Node version from .tool-versions
corepack enable     # enables pnpm
pnpm install
pnpm dev            # starts the proxy with hot reload on :8080
```

## Docker

```bash
docker build -t asset-proxy -f packages/proxy/Dockerfile .
```

### CPU only

```bash
docker run -e SKIP_GPU=1 -p 8080:8080 asset-proxy
```

### With GPU (NVIDIA)

```bash
docker run --gpus all -p 8080:8080 asset-proxy
```

Requires the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html).

## Deployment

CI/CD runs automatically on pushes to `main` and on pull requests. After tests pass, the CD job builds a Docker image and pushes it to GitHub Container Registry (`ghcr.io/socialtip/asset-proxy`). The `@socialtip/asset-proxy-url-parser` and `@socialtip/asset-proxy-url-generator` packages are published to GitHub Packages on release.

Images are tagged with the commit SHA. Pushes to `main` are additionally tagged `latest`.

## Testing

See [docs/Testing.md](docs/Testing.md) for full testing documentation, including integration tests and deployment test plans.

## Environment variables

| Variable                           | Default                               | Description                                                                                                                               |
| ---------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                             | `8080`                                | Server listen port                                                                                                                        |
| `SKIP_GPU`                         | —                                     | Set to `1` to fall back to CPU encoding. Without this, GPU is required and the process will fail if NVENC is not available.               |
| `SIGNING_KEY`                      | —                                     | Hex-encoded HMAC-SHA256 key for URL signature verification. Must be set together with `SIGNING_SALT`.                                     |
| `SIGNING_SALT`                     | —                                     | Hex-encoded salt prepended to the path before HMAC signing. Must be set together with `SIGNING_KEY`.                                      |
| `SOURCE_URL_ENCRYPTION_KEY`        | —                                     | 32-byte hex-encoded AES-256-CBC key (64 hex characters) for decrypting `/enc/` source URLs. When unset, encrypted URLs are not supported. |
| `ALLOWED_ORIGINS`                  | —                                     | Comma-separated list of allowed source URL origins (e.g. `https://example.com,gs://my-bucket`). When unset, all origins are permitted.    |
| `CACHE_CONTROL`                    | `public, max-age=31536000, immutable` | Cache-Control header value for successful responses.                                                                                      |
| `STRIP_METADATA`                   | `true`                                | Strip EXIF/IPTC metadata from output images by default.                                                                                   |
| `KEEP_COPYRIGHT`                   | `true`                                | Preserve copyright metadata when stripping. Uses exiftool to copy from source.                                                            |
| `STRIP_COLOR_PROFILE`              | `true`                                | Strip embedded ICC colour profile from output images by default.                                                                          |
| `ENFORCE_THUMBNAIL`                | `false`                               | Prefer embedded thumbnails over full image for HEIC/AVIF sources.                                                                         |
| `AUTOQUALITY_METHOD`               | `none`                                | Autoquality method: `none`, `dssim`, or `size`.                                                                                           |
| `AUTOQUALITY_TARGET`               | —                                     | Target value (DSSIM for dssim, bytes for size).                                                                                           |
| `AUTOQUALITY_MIN`                  | —                                     | Minimum quality for autoquality search.                                                                                                   |
| `AUTOQUALITY_MAX`                  | —                                     | Maximum quality for autoquality search.                                                                                                   |
| `AUTOQUALITY_ALLOWED_ERROR`        | —                                     | Allowed DSSIM deviation from target.                                                                                                      |
| `AUTOQUALITY_FORMAT_MIN`           | —                                     | Format-specific min quality, e.g. `avif=60,webp=70`.                                                                                      |
| `AUTOQUALITY_FORMAT_MAX`           | —                                     | Format-specific max quality, e.g. `avif=65,webp=80`.                                                                                      |
| `BEST_FORMAT_COMPLEXITY_THRESHOLD` | `5.5`                                 | Entropy threshold for best format selection. Below this, lossless formats are preferred; at or above, lossy formats are preferred.        |
| `BEST_FORMAT_MAX_RESOLUTION`       | `0`                                   | When > 0, skip best format testing for images exceeding this megapixel count (falls back to JPEG).                                        |
| `BEST_FORMAT_BY_DEFAULT`           | `false`                               | Automatically use best format selection when no explicit output format is specified.                                                      |
| `MAX_SRC_RESOLUTION`               | `0`                                   | Max source resolution in megapixels. 0 = unlimited.                                                                                       |
| `MAX_SRC_FILE_SIZE`                | `0`                                   | Max source file size in bytes. 0 = unlimited.                                                                                             |
| `MAX_ANIMATION_FRAMES`             | `0`                                   | Max animation frames for video thumbnail animations. 0 = unlimited.                                                                       |
| `MAX_ANIMATION_FRAME_RESOLUTION`   | `0`                                   | Max animation frame resolution in megapixels. 0 = unlimited.                                                                              |
| `MAX_RESULT_DIMENSION`             | `0`                                   | Max result width or height in pixels. 0 = unlimited.                                                                                      |

## Health check

```
GET /health → 200 ok
```
