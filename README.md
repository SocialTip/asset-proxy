# st-assets

A video processing service with an [imgproxy](https://docs.imgproxy.net/usage/processing)-compatible URL API. Uses ffmpeg with optional NVIDIA GPU acceleration.

## URL format

```
/insecure/resize:<type>:<width>:<height>/plain/<source_url>
```

**Example:**

```
/insecure/resize:fill:480:360/plain/https://example.com/my-video.mp4
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

## Health check

```
GET /health → 200 ok
```
