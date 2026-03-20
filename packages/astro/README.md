# @socialtip/asset-proxy-astro

An [Astro image service](https://docs.astro.build/en/reference/image-service-reference/) that delegates image processing to an [asset-proxy](../../README.md) instance.

Implements Astro's `ExternalImageService` interface — no images are processed at build time. Instead, `<Image>` and `getImage()` calls produce URLs pointing to your asset-proxy deployment.

## Installation

```bash
pnpm add @socialtip/asset-proxy-astro
```

## Configuration

In your `astro.config.mjs`:

```js
import { defineConfig } from "astro/config";

export default defineConfig({
  image: {
    service: {
      entrypoint: "@socialtip/asset-proxy-astro",
      config: {
        baseUrl: "https://assets.example.com",
      },
    },
  },
});
```

### Config options

| Option                    | Type      | Required | Description                                                                                         |
| ------------------------- | --------- | -------- | --------------------------------------------------------------------------------------------------- |
| `baseUrl`                 | `string`  | Yes      | Base URL of your asset-proxy instance.                                                              |
| `signingKey`              | `string`  | No       | Hex-encoded HMAC-SHA256 key for URL signing. Must be set together with `signingSalt`.               |
| `signingSalt`             | `string`  | No       | Hex-encoded salt prepended to the path before HMAC signing. Must be set together with `signingKey`. |
| `encryptionKey`           | `string`  | No       | Hex-encoded 32-byte AES-256-CBC key for encrypting the source URL.                                  |
| `deterministicEncryption` | `boolean` | No       | When `true`, derives the encryption IV from the source URL for stable/cacheable URLs.               |

## Usage

Once configured, Astro's built-in `<Image>` component and `getImage()` function will automatically route through asset-proxy:

```astro
---
import { Image } from "astro:assets";
---

<Image
  src="https://example.com/photo.jpg"
  width={800}
  height={600}
  format="webp"
  quality={80}
  alt="A photo"
/>
```

This renders an `<img>` tag whose `src` points to your asset-proxy instance:

```
https://assets.example.com/_/rs:fit:800:600/q:80/plain/https://example.com/photo.jpg@webp
```

### Supported Astro props

| Prop      | Mapped to                                                                          |
| --------- | ---------------------------------------------------------------------------------- |
| `width`   | `resize` width                                                                     |
| `height`  | `resize` height                                                                    |
| `quality` | `quality` (numeric or preset: `low` = 30, `mid` = 50, `high` = 80, `max` = 100)    |
| `format`  | Output format suffix (`jpeg` is normalised to `jpg`)                               |
| `fit`     | Resizing type (`contain`/`scale-down` → `fit`, `cover` → `fill`, `fill` → `force`) |

## Custom `<Image>` component

The Astro image service only exposes the subset of proxy options that Astro's `ImageTransform` supports. For full access to all ~70 proxy options, use the custom `<Image>` component:

```astro
---
import Image from "@socialtip/asset-proxy-astro/Image.astro";
---

<Image
  src="https://example.com/photo.jpg"
  options={{
    resize: { type: "fill", width: 640, height: 480 },
    quality: 90,
    outputFormat: "avif",
    blur: 2,
    gravity: "ce",
  }}
  alt="A photo"
/>
```

The component reads `baseUrl` and signing/encryption settings from your `astro.config.mjs` image service config automatically. No need to pass `config` unless you want to override it per-image.

The component accepts:

- **`src`** (required) — the source image/video URL
- **`config`** — override the global `AssetProxyServiceConfig` for this image (optional — defaults to the config from `astro.config.mjs`)
- **`options`** — a `Partial<ParsedUrlInput>` object with proxy processing options (e.g. `resize`, `crop`, `gravity`, `blur`, `sharpen`, `monochrome`, `framerate`, etc.)
- Standard HTML `<img>` attributes (`alt`, `class`, `loading`, `decoding`, etc.)

It defaults to `loading="lazy"` and `decoding="async"`, matching Astro's built-in behaviour.

## Custom `<Video>` component

The `<Video>` component works identically to `<Image>` but renders a `<video>` tag:

```astro
---
import Video from "@socialtip/asset-proxy-astro/Video.astro";
---

<Video
  src="https://example.com/clip.mp4"
  options={{
    resize: { type: "fit", width: 1280, height: 720 },
    outputFormat: "mp4",
    framerate: 30,
    cut: 10,
    mute: true,
  }}
  controls
  autoplay
  muted
/>
```

The component accepts:

- **`src`** (required) — the source video URL
- **`config`** — override the global `AssetProxyServiceConfig` for this video (optional — defaults to the config from `astro.config.mjs`)
- **`options`** — a `Partial<ParsedUrlInput>` object with proxy processing options (e.g. `resize`, `framerate`, `cut`, `mute`, `outputFormat`, etc.)
- Standard HTML `<video>` attributes (`controls`, `autoplay`, `muted`, `loop`, `poster`, `width`, `height`, etc.)

## `getImageUrl` helper

For cases where you need the URL string directly (e.g. in CSS, `srcset`, or server endpoints), use `getImageUrl`:

```ts
import { getImageUrl } from "@socialtip/asset-proxy-astro";

const url = getImageUrl(
  {
    src: "https://example.com/photo.jpg",
    resize: { type: "fit", width: 800, height: 600 },
    quality: 80,
    outputFormat: "webp",
  },
  { baseUrl: "https://assets.example.com" },
);
```
