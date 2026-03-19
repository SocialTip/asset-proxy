# @asset-proxy/proxy

The image and video processing service, exposed via an [imgproxy](https://docs.imgproxy.net/usage/processing)-compatible URL API. Uses [ffmpeg](https://ffmpeg.org/) (with optional NVIDIA GPU acceleration) for the vast majority of processing, and [sharp](https://sharp.pixelplumbing.com/) for certain image-specific operations like autoquality, format-specific encoder options, and max-bytes compression.

See the [project README](../../README.md) for full documentation on the URL format, processing options, deployment, and environment variables.

## Development

```bash
yarn dev  # starts the proxy with hot reload on :8080
```

## Testing

```bash
yarn test:up    # start containers (from repo root)
yarn test       # run all tests
yarn test:down  # stop containers
```
