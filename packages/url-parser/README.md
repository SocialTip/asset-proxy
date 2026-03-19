# @socialtip/asset-proxy-url-parser

Shared URL schema, parsing, signature verification/generation, and source URL encryption for the [asset-proxy](../../README.md) service.

## Installation

```bash
npm install @socialtip/asset-proxy-url-parser
```

## Usage

### Parsing a URL

```ts
import { parseProcessingUrl } from "@socialtip/asset-proxy-url-parser";

const parsed = parseProcessingUrl(
  "/resize:fill:480:360/q:80/plain/https://example.com/photo.jpg@webp",
);

parsed.resize; // { type: "fill", width: 480, height: 360 }
parsed.quality; // 80
parsed.sourceUrl; // "https://example.com/photo.jpg"
parsed.outputFormat; // "webp"
```

With encrypted source URLs:

```ts
const parsed = parseProcessingUrl("/resize:fill:480:360/enc/dGhpcyBpcy...", {
  encryptionKey: Buffer.from("0123456789abcdef...", "hex"),
});
```

### Signature verification and generation

```ts
import { verifySignature, sign } from "@socialtip/asset-proxy-url-parser";

// Generate a signature
const key = Buffer.from("...", "hex");
const salt = Buffer.from("...", "hex");
const signature = sign(
  "/resize:fill:480:360/plain/https://example.com/photo.jpg",
  key,
  salt,
);

// Verify a signed URL
const pathAfterSignature = verifySignature(
  `/${signature}/resize:fill:480:360/plain/https://example.com/photo.jpg`,
  { signingKey: key, signingSalt: salt },
);
```

### Source URL encryption

```ts
import {
  encryptSourceUrl,
  decryptSourceUrl,
} from "@socialtip/asset-proxy-url-parser";

const key = Buffer.from("0123456789abcdef...", "hex"); // 32-byte key
const encrypted = encryptSourceUrl("https://example.com/photo.jpg", key);
const decrypted = decryptSourceUrl(encrypted, key);
```

### Schema and types

```ts
import {
  parsedUrlSchema, // Zod schema for validated processing options
  type ParsedUrlInput, // Input type (z.input<typeof parsedUrlSchema>)
  type ParsedUrl, // Output type with resizingAlgorithm
} from "@socialtip/asset-proxy-url-parser";
```
