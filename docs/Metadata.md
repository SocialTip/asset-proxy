# Metadata (Info Endpoint)

The `/info/` endpoint returns JSON metadata about a source asset (image or video) without processing it.

See also: [Image Processing](Image.md), [Video Processing](Video.md)

## URL format

```
/info/<signature>/<options>/plain/<source_url>
/info/<signature>/<options>/enc/<encrypted_source_url>
```

The path after `/info` follows the same format as processing URLs — the same signature verification, encryption, and origin checks apply. Processing options in the URL are ignored; only the source URL, security options, and info-specific options are used.

**Examples:**

```
/info/_/plain/https://example.com/photo.jpg
/info/oKfUtW34Dvo.../enc/dGhpcyBpcyBhIGJhc2U2NC...
```

## Response

Returns `application/json` with a `Cache-Control` header.

**Image response:**

```json
{
  "format": "png",
  "mime_type": "image/png",
  "width": 1920,
  "height": 1080,
  "orientation": 1,
  "size": 245760
}
```

**Video response:**

```json
{
  "format": "mov",
  "mime_type": "video/quicktime",
  "width": 1920,
  "height": 1080,
  "size": 5242880,
  "duration": 30.5,
  "video_meta": {
    "codec": "h264",
    "bitrate": 1200000,
    "framerate": 29.97
  }
}
```

### Response fields

| Field             | Type   | Description                                                                    |
| ----------------- | ------ | ------------------------------------------------------------------------------ |
| `format`          | string | Codec name (images) or container format (videos)                               |
| `mime_type`       | string | MIME type of the source                                                        |
| `width`           | number | Width in pixels (adjusted for EXIF orientation)                                |
| `height`          | number | Height in pixels (adjusted for EXIF orientation)                               |
| `orientation`     | number | EXIF orientation value (1-8). Defaults to 1 when absent. Images only.          |
| `colorspace`      | string | Colour space (only when `cs` info option is enabled)                           |
| `bands`           | number | Number of image bands/channels (only when `b` info option is enabled)          |
| `sample_format`   | string | Sample format: uchar, ushort, or float (only when `sf` info option is enabled) |
| `pages_number`    | number | Page/frame count (only when `pn` info option is enabled)                       |
| `alpha`           | object | Alpha channel info (only when `a` info option is enabled)                      |
| `size`            | number | File size in bytes                                                             |
| `duration`        | number | Duration in seconds (video only)                                               |
| `video_meta`      | object | Video stream details (video only)                                              |
| `exif`            | object | EXIF metadata grouped by IFD section (only when `exif` info option is enabled) |
| `iptc`            | object | IPTC metadata (only when `iptc` info option is enabled)                        |
| `xmp`             | object | XMP metadata organised by namespace (only when `xmp` info option is enabled)   |
| `palette`         | array  | RGBA colour palette (only when `p` info option is enabled)                     |
| `average`         | object | Average RGB colour (only when `avg` info option is enabled)                    |
| `dominant_colors` | object | Six dominant colour categories (only when `dc` info option is enabled)         |
| `blurhash`        | string | BlurHash string (only when `bh` info option is enabled)                        |
| `hashsums`        | object | Source file checksums (only when `chs` info option is enabled)                 |

## Info options

Info-specific options control which additional metadata is returned. They are placed in the URL path alongside processing options.

| Option            | Shorthand | Description                                                                   |
| ----------------- | --------- | ----------------------------------------------------------------------------- |
| `exif`            |           | Include EXIF metadata                                                         |
| `iptc`            |           | Include IPTC metadata                                                         |
| `xmp`             |           | Include XMP metadata                                                          |
| `colorspace`      | `cs`      | Include colour space                                                          |
| `bands`           | `b`       | Include bands count                                                           |
| `sample_format`   | `sf`      | Include sample format                                                         |
| `pages_number`    | `pn`      | Include page count                                                            |
| `alpha`           | `a`       | Include alpha info                                                            |
| `palette`         | `p`       | Return RGBA colour palette (value = max colours, 2-256)                       |
| `average`         | `avg`     | Return average RGB colour (`avg:t` or `avg:t:t` to ignore transparent pixels) |
| `dominant_colors` | `dc`      | Return six dominant colour categories                                         |
| `blurhash`        | `bh`      | Return BlurHash string (value = `<x>:<y>` components)                         |
| `calc_hashsums`   | `chs`     | Return file checksums (value = hash types: md5, sha1, sha256, sha512)         |

## URL generator

```ts
import { generateInfoUrl } from "@socialtip/asset-proxy-url-generator";

const url = generateInfoUrl({
  sourceUrl: "https://example.com/photo.jpg",
});
// => /info/insecure/plain/https://example.com/photo.jpg

const urlWithExif = generateInfoUrl(
  { sourceUrl: "https://example.com/photo.jpg" },
  undefined,
  { exif: true },
);
// => /info/insecure/exif:t/plain/https://example.com/photo.jpg
```
