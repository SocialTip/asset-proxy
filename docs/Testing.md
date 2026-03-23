# Testing

## Unit and integration tests

Integration tests require a running service via Docker Compose. This starts the asset-proxy container (CPU mode) alongside an nginx file server that serves test fixtures:

```bash
pnpm test:up      # start containers (builds image, waits for healthy)
pnpm test         # run all tests across all packages
pnpm test:down    # stop and remove containers
```

If the containers are already running and you only need to pick up code changes, use `pnpm test:restart` instead of `pnpm test:up` (avoids a full rebuild unless the Dockerfile changed).

Note that unit and integration tests run in CPU mode and cannot cover GPU-specific functionality (e.g. NVENC encoding, GPU scalers like `scale_cuda` / `scale_npp`), as these require an NVIDIA GPU in the environment. GPU features should be verified using the deployment test plan below against a GPU-enabled deployment.

## Deployment test plan

The `scripts/create-test-plan.ts` script generates a markdown test plan for verifying a live asset-proxy deployment. The plan tests each feature in isolation and records output metrics (file size, dimensions, duration, timing).

### Usage

```bash
npx tsx scripts/create-test-plan.ts \
  --video "gs://my-bucket/test-video.mp4" \
  --image "gs://my-bucket/test-image.jpg" \
  --url "https://asset-proxy.example.com" \
  --signing-key-secret "signing-key" \
  --signing-salt-secret "signing-salt" \
  --encryption-key-secret "encryption-key"
```

This creates a plan at `test-plans/<timestamp>/plan.md`.

### Arguments

| Argument                  | Required | Description                               |
| ------------------------- | -------- | ----------------------------------------- |
| `--video`                 | Yes      | `gs://` URL to a test video               |
| `--image`                 | Yes      | `gs://` URL to a test image               |
| `--url`                   | Yes      | Base URL of the deployment to test        |
| `--signing-key-secret`    | No       | gcloud secret name for the signing key    |
| `--signing-salt-secret`   | No       | gcloud secret name for the signing salt   |
| `--encryption-key-secret` | No       | gcloud secret name for the encryption key |

When signing or encryption secrets are provided, the script fetches them via `gcloud secrets versions access` and all generated URLs use signing/encryption. When omitted, URLs use an insecure signature and plaintext source URLs. Signing key and salt must be provided together; encryption key can be provided independently.

### What it tests

The generated plan covers the following areas, each tested in isolation:

- **Image processing** — resize (fit/fill), width, quality, format conversions (webp, avif, png), best format, blur, sharpen, rotate, flip, crop aspect ratio, brightness, monochrome, pixelate, padding, gradient, raw passthrough
- **Video processing** — resize, cut, mute, framerate, format conversion (webm), video thumbnail, animated thumbnail (gif)
- **Info endpoint** — basic image/video info, EXIF, hashsums, dominant colours, blurhash
- **Health check**

### Directory structure

```
test-plans/
  2026-03-23-18-39-29/
    plan.md
    run-2026-03-25-11-29-03/
      test-image-sharpen.jpg
      test-image-format.png
      ...
```

Each run of the plan creates a timestamped subdirectory for output files, keeping runs isolated from each other.

### Running the plan

The output markdown is designed to be run by Claude. Tell Claude:

> I've created a test plan for asset proxy in `test-plans/2026-03-23-18-39-29/plan.md`. Run it for me please.

Claude will create a run subdirectory, execute each `curl` command from within it, inspect output files with `ffprobe` / `file` / `stat`, fill in the results tables, and update the "Last run" timestamp.
