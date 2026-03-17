# assets-proxy

An image and video processing service with an [imgproxy](https://docs.imgproxy.net/usage/processing)-compatible URL API. Uses sharp for images and ffmpeg (with optional NVIDIA GPU acceleration) for video.

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

Options are path segments between the signature and the source URL. Compatible with the [imgproxy processing API](https://docs.imgproxy.net/usage/processing).

#### Resize — `resize:<type>:<width>:<height>` (shorthand `rs`)

| Type        | Behaviour                                                      |
| ----------- | -------------------------------------------------------------- |
| `fit`       | Scale to fit within the box, preserving aspect ratio (default) |
| `fill`      | Scale to cover the box, cropping the excess                    |
| `fill-down` | Like `fill`, but never upscales                                |
| `force`     | Stretch to exact dimensions, ignoring aspect ratio             |
| `auto`      | Uses `fill` when orientations match, otherwise `fit`           |

#### Size — `size:<width>:<height>` (shorthand `s`)

Shorthand for setting width and height without specifying resize type (defaults to `fit`).

#### Width / Height — `width:<w>` (`w`) / `height:<h>` (`h`)

Set dimensions individually. When used without a `resize` segment, defaults to `fit`.

#### Resizing Algorithm — `resizing_algorithm:<algorithm>` (shorthand `ra`)

Controls the scaling algorithm. Supports CPU and GPU modes:

**CPU algorithms** (for images and video thumbnails): `nearest`, `linear`, `cubic`, `lanczos2`, `lanczos3`. Example: `ra:lanczos3`.

**GPU scalers** (video processing with GPU acceleration only): `gpu:scale_cuda`, `gpu:scale_npp`. When no resizing algorithm is specified, GPU video resize uses the cuvid decoder's built-in resize (`-resize`), which only supports `force` mode with both width and height specified. To use other resize modes (fit, fill, fill-down, auto) with GPU, specify an explicit GPU scaler. The `scale_npp` scaler also supports an interpolation algorithm suffix: `gpu:scale_npp:cubic`, `gpu:scale_npp:lanczos3`, etc. Available `scale_npp` interpolation algorithms: `nearest`, `linear`, `cubic`, `lanczos2`, `lanczos3`.

GPU scaler variants are not available when extracting image thumbnails — use the CPU algorithms instead.

#### Enlarge — `enlarge:1` (shorthand `el`)

Allow upscaling when the image is smaller than the target dimensions. Off by default.

#### Crop — `crop:<width>:<height>:<gravity>` (shorthand `c`)

Extract a region before resizing. Values less than 1 are treated as relative to source dimensions.

#### Crop Aspect Ratio — `crop_aspect_ratio:<width>:<height>` (shorthand `car`)

Crop the image or video to the given aspect ratio before any other processing. Example: `car:16:9`, `car:1:1`.

#### Gravity — `gravity:<type>` (shorthand `g`)

Anchor point for crop operations.

**Compass gravity:** `no` (north), `so` (south), `ea` (east), `we` (west), `noea`, `nowe`, `soea`, `sowe`, `ce` (centre).

**Focus point gravity:** `fp:<x>:<y>` where x and y are floats between 0 and 1 representing the focus point. Example: `g:fp:0.3:0.7`. The crop window is centred on the focus point, clamped to image bounds.

#### Quality — `quality:<1-100>` (shorthand `q`)

Output quality for lossy formats (JPEG, WebP, AVIF).

#### Blur — `blur:<sigma>` (shorthand `bl`)

Gaussian blur. Example: `bl:5`.

#### Sharpen — `sharpen:<sigma>` (shorthand `sh`)

Sharpening. Example: `sh:1.5`.

#### Rotate — `rotate:<angle>` (shorthand `rot`)

Rotate by 0, 90, 180, or 270 degrees.

#### Auto Rotate — `auto_rotate:1` (shorthand `ar`)

Rotate based on EXIF orientation data. Enabled by default.

#### Background — `background:<hex>` or `background:<R>:<G>:<B>` (shorthand `bg`)

Background colour for padding and alpha flattening. Example: `bg:ff0000` or `bg:255:0:0`.

#### Padding — `padding:<top>:<right>:<bottom>:<left>` (shorthand `pd`)

Extend the canvas. A single value applies uniform padding: `pd:10`.

#### Strip Metadata — `strip_metadata:1` (shorthand `sm`)

Remove EXIF and other metadata from the output.

#### Format — `format:<extension>` (shorthand `f`)

Alternative to the `@suffix` for specifying output format.

#### Framerate — `framerate:<fps>` (shorthand `fr`) — video only

Sets the output framerate. Example: `fr:30`.

#### Trim — `trim:<threshold>:<colour>:<equal_hor>:<equal_vert>` (shorthand `tr`)

Remove borders from an image using colour similarity detection. The threshold (required) controls how similar a pixel must be to the border colour to be trimmed (0–255). Optional parameters: hex colour to trim (defaults to auto-detect), `equal_hor` and `equal_vert` (1/t/true) to trim equal amounts from opposite sides. Example: `trim:10:ffffff:1:1`. Note: requires a two-pass ffmpeg analysis and increases processing time.

#### Cut — `cut:<seconds>` (shorthand `ct`) — video only

Limits output duration to the given number of seconds. Example: `ct:10`.

### Output format

Append a format suffix to the source URL to choose the output format:

**Video:** `@mp4` (default for video), `@webm`

- **`mp4`** — H.264 video, audio copied through
- **`webm`** — VP9 video, Opus audio

**Image:** `@jpg`, `@png`, `@webp`, `@avif`, `@gif`

- Default is `jpg` when the source is an image

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

## Development

Requires [asdf](https://asdf-vm.com/) with the `nodejs` plugin.

```bash
asdf install        # installs Node version from .tool-versions
corepack enable     # enables yarn
yarn install
yarn dev            # starts the server with hot reload on :8080
```

## Docker

```bash
docker build -t asset-proxy .
```

### CPU only

```bash
docker run -p 8080:8080 asset-proxy
```

### With GPU (NVIDIA)

```bash
docker run --gpus all -p 8080:8080 asset-proxy
```

Requires the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html).

## Testing

Integration tests require a running service via Docker Compose. This starts the asset-proxy container (CPU mode) alongside an nginx file server that serves test fixtures:

```bash
yarn test:up      # start containers (builds image, waits for healthy)
yarn test         # run all tests (unit + integration)
yarn test:down    # stop and remove containers
```

## Environment variables

| Variable                    | Default                               | Description                                                                                                                               |
| --------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                      | `8080`                                | Server listen port                                                                                                                        |
| `SKIP_GPU`                  | —                                     | Set to `1` to fall back to CPU encoding. Without this, GPU is required and the process will fail if NVENC is not available.               |
| `SIGNING_KEY`               | —                                     | Hex-encoded HMAC-SHA256 key for URL signature verification. Must be set together with `SIGNING_SALT`.                                     |
| `SIGNING_SALT`              | —                                     | Hex-encoded salt prepended to the path before HMAC signing. Must be set together with `SIGNING_KEY`.                                      |
| `SOURCE_URL_ENCRYPTION_KEY` | —                                     | 32-byte hex-encoded AES-256-CBC key (64 hex characters) for decrypting `/enc/` source URLs. When unset, encrypted URLs are not supported. |
| `ALLOWED_ORIGINS`           | —                                     | Comma-separated list of allowed source URL origins (e.g. `https://example.com,gs://my-bucket`). When unset, all origins are permitted.    |
| `CACHE_CONTROL`             | `public, max-age=31536000, immutable` | Cache-Control header value for successful responses.                                                                                      |

## Health check

```
GET /health → 200 ok
```
