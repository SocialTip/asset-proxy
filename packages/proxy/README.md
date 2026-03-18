# @asset-proxy/proxy

The image and video processing service. Uses [sharp](https://sharp.pixelplumbing.com/) for images and [ffmpeg](https://ffmpeg.org/) (with optional NVIDIA GPU acceleration) for video, exposed via an [imgproxy](https://docs.imgproxy.net/usage/processing)-compatible URL API.

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
