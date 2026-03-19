# proxy

The image and video processing service, exposed via an [imgproxy](https://docs.imgproxy.net/usage/processing)-compatible URL API. Uses [ffmpeg](https://ffmpeg.org/) (with optional NVIDIA GPU acceleration) for the vast majority of processing, and [sharp](https://sharp.pixelplumbing.com/) for certain image-specific operations like autoquality, format-specific encoder options, and max-bytes compression.

See the [project README](../../README.md) for full documentation on the URL format, processing options, deployment, and environment variables.

## Deployment

Deployed as a Docker image to GCP Cloud Run. The Dockerfile is in the repository root (`/Dockerfile`) since it depends on multiple packages (url-parser and proxy). The CD workflow builds and pushes the image to GitHub Container Registry on every push to main.

## Development

```bash
pnpm dev  # starts the proxy with hot reload on :8080
```

## Testing

```bash
pnpm test:up    # start containers (from repo root)
pnpm test       # run all tests
pnpm test:down  # stop containers
```
