# st-assets

A video processing service with an [imgproxy](https://docs.imgproxy.net/usage/processing)-compatible URL API. Uses ffmpeg with optional NVIDIA GPU acceleration.

## URL format

```
/insecure/resize:<type>:<width>:<height>/plain/<source_url>
/insecure/resize:<type>:<width>:<height>/enc/<encrypted_source_url>
```

**Examples:**

```
/insecure/resize:fill:480:360/plain/https://example.com/my-video.mp4
/insecure/resize:fill:480:360/enc/dGhpcyBpcyBhIGJhc2U2NCBlbmNvZGVk...
```

### Resize types

| Type        | Behaviour                                                        |
| ----------- | ---------------------------------------------------------------- |
| `fit`       | Scale to fit within the box, preserving aspect ratio (default)   |
| `fill`      | Scale to cover the box, cropping the excess                      |
| `fill-down` | Like `fill`, but never upscales                                  |
| `force`     | Stretch to exact dimensions, ignoring aspect ratio               |
| `auto`      | Uses `fill` when orientations match, otherwise `fit`             |

The shorthand `rs` is also accepted (e.g. `rs:fill:480:360`).

### Encrypted source URLs

Source URLs can be encrypted using AES-256-CBC, following the [imgproxy encrypted source URL format](https://docs.imgproxy.net/usage/encrypting_source_url):

1. Pad the source URL with PKCS#7 to 16-byte alignment
2. Generate a 16-byte IV
3. Encrypt with AES-256-CBC using the key and IV
4. Concatenate: `IV + ciphertext`
5. Encode with URL-safe Base64

Use the `/enc/` prefix instead of `/plain/` in the URL path. Requires `SOURCE_URL_ENCRYPTION_KEY` to be set.

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
docker build -t st-assets .
```

### CPU only

```bash
docker run -p 8080:8080 st-assets
```

### With GPU (NVIDIA)

```bash
docker run --gpus all -p 8080:8080 st-assets
```

Requires the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html).

## Environment variables

| Variable   | Default | Description                                                        |
| ---------- | ------- | ------------------------------------------------------------------ |
| `PORT`     | `8080`  | Server listen port                                                 |
| `SKIP_GPU` | —       | Set to `1` to fall back to CPU encoding. Without this, GPU is required and the process will fail if NVENC is not available. |
| `SOURCE_URL_ENCRYPTION_KEY` | — | 32-byte hex-encoded AES-256-CBC key (64 hex characters) for decrypting `/enc/` source URLs. When unset, encrypted URLs are not supported. |

## Health check

```
GET /health → 200 ok
```
