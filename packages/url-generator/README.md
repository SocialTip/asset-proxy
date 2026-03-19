# @socialtip/asset-proxy-url-generator

Generate [asset-proxy](../../README.md)-compatible URL paths programmatically, with optional source URL encryption and HMAC signing.

## Installation

```bash
npm install @socialtip/asset-proxy-url-generator
```

## Usage

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

### Encrypted source URLs

```ts
const url = generateUrl(
  { sourceUrl: "https://example.com/photo.jpg", outputFormat: "webp" },
  { encryptionKey: "0123456789abcdef..." }, // hex-encoded 32-byte key
);
// => /_/enc/dGhpcyBpcy...@webp
```

### Signed URLs

```ts
const url = generateUrl(
  { sourceUrl: "https://example.com/photo.jpg" },
  {
    signingKey: "...", // hex-encoded HMAC key
    signingSalt: "...", // hex-encoded salt
  },
);
// => /oKfUtW34Dvo.../plain/https://example.com/photo.jpg
```

### All options

The `generateUrl` function accepts all processing options from the asset-proxy URL schema. See the [full options reference](../../README.md#processing-options) for details.
