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
