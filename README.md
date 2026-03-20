# asset-proxy

An image and video processing service with an [imgproxy](https://docs.imgproxy.net/usage/processing)-compatible URL API. Uses ffmpeg (with optional NVIDIA GPU acceleration) for the vast majority of processing, and sharp for certain image-specific operations.

## URL format

```
/<signature>/<options>/plain/<source_url>[@<format>]
/<signature>/<options>/enc/<encrypted_source_url>[@<format>]
```

The signature segment is always required structurally. When `SIGNING_KEY` and `SIGNING_SALT` are not set, any value is accepted (e.g. `_`). When they are set, the signature is validated as described below.

**Examples:**

```
/_/resize:fill:480:360/plain/https://example.com/my-video.mp4
/_/resize:fill:480:360/fr:30/tr:10/plain/https://example.com/my-video.mp4@webm
/_/w:300/q:80/plain/https://example.com/photo.jpg@webp
/oKfUtW34Dvo.../resize:fill:480:360/enc/dGhpcyBpcyBhIGJhc2U2NC...
```

The service automatically detects whether to use image or video processing based on the output format suffix and source URL extension.

### Processing options

Options are path segments between the signature and the source URL. Compatible with the [imgproxy processing API](https://docs.imgproxy.net/usage/processing).

#### Resize — `resize:<type>:<width>:<height>` (shorthand `rs`)

| Type        | Behaviour                                                      |
| ----------- | -------------------------------------------------------------- |
| `fit`       | Scale to fit within the box, preserving aspect ratio (default) |
| `fill`      | Scale to cover the box, cropping the excess                    |
| `fill-down` | Like `fill`, but never upscales                                |
| `force`     | Stretch to exact dimensions, ignoring aspect ratio             |
| `auto`      | Uses `fill` when orientations match, otherwise `fit`           |

#### Size — `size:<width>:<height>` (shorthand `s`)

Shorthand for setting width and height without specifying resize type (defaults to `fit`).

#### Width / Height — `width:<w>` (`w`) / `height:<h>` (`h`)

Set dimensions individually. When used without a `resize` segment, defaults to `fit`.

#### Resizing Algorithm — `resizing_algorithm:<algorithm>` (shorthand `ra`)

Controls the scaling algorithm. Supports CPU and GPU modes:

**CPU algorithms** (for images and video thumbnails): `nearest`, `linear`, `cubic`, `lanczos2`, `lanczos3`. Example: `ra:lanczos3`.

**GPU scalers** (video processing with GPU acceleration only): `gpu:scale_cuda`, `gpu:scale_npp`. When no resizing algorithm is specified, GPU video resize uses the cuvid decoder's built-in resize (`-resize`), which only supports `force` mode with both width and height specified. To use other resize modes (fit, fill, fill-down, auto) with GPU, specify an explicit GPU scaler. The `scale_npp` scaler also supports an interpolation algorithm suffix: `gpu:scale_npp:cubic`, `gpu:scale_npp:lanczos3`, etc. Available `scale_npp` interpolation algorithms: `nearest`, `linear`, `cubic`, `lanczos2`, `lanczos3`.

GPU scaler variants are not available when extracting image thumbnails — use the CPU algorithms instead.

#### Min Width / Min Height — `min_width:<w>` (`mw`) / `min_height:<h>` (`mh`)

Ensure the output is at least the specified width or height, upscaling if necessary while preserving aspect ratio.

#### Zoom — `zoom:<factor>` or `zoom:<x>:<y>` (shorthand `z`)

Multiply resize dimensions by the given factor. Example: `z:2` doubles the output size. Supports separate x/y factors: `z:2:1.5`.

#### DPR — `dpr:<ratio>`

Device pixel ratio — multiplies dimensions and padding. Example: `dpr:2`.

#### Enlarge — `enlarge:1` (shorthand `el`)

Allow upscaling when the image is smaller than the target dimensions. Off by default.

#### Extend — `extend:<enabled>:<gravity>` (shorthand `ex`)

Pad undersized images to fill the target resize dimensions. Example: `ex:1:ce` (extend with centre gravity).

#### Extend Aspect Ratio — `extend_aspect_ratio:<enabled>:<gravity>` (shorthand `exar`)

Extend the image to match the target aspect ratio.

#### Crop — `crop:<width>:<height>:<gravity>` (shorthand `c`)

Extract a region before resizing. Values less than 1 are treated as relative to source dimensions.

#### Crop Aspect Ratio — `crop_aspect_ratio:<width>:<height>` (shorthand `car`)

Crop the image or video to the given aspect ratio before any other processing. Example: `car:16:9`, `car:1:1`.

#### Gravity — `gravity:<type>` (shorthand `g`)

Anchor point for crop operations.

**Compass gravity:** `no` (north), `so` (south), `ea` (east), `we` (west), `noea`, `nowe`, `soea`, `sowe`, `ce` (centre).

**Focus point gravity:** `fp:<x>:<y>` where x and y are floats between 0 and 1 representing the focus point. Example: `g:fp:0.3:0.7`. The crop window is centred on the focus point, clamped to image bounds.

#### Quality — `quality:<1-100>` (shorthand `q`)

Output quality for lossy formats (JPEG, WebP, AVIF).

#### Format Quality — `format_quality:<fmt1>:<q1>:<fmt2>:<q2>` (shorthand `fq`)

Per-format quality overrides. Example: `fq:jpg:80:webp:90:avif:60`. Overrides the global `quality` setting for specific formats.

#### Max Bytes — `max_bytes:<bytes>` (shorthand `mb`)

Automatically degrade quality until the output fits under the given byte size. Applies to lossy formats only (jpg, webp, avif). Uses binary search on quality. Example: `mb:50000`.

#### Autoquality — `autoquality:<method>:<target>:<min>:<max>:<allowed_error>` (shorthand `aq`)

Automatically select quality level. Methods: `dssim` (target structural dissimilarity, default 0.02), `size` (target file size in bytes). Min/max bound the quality search range. Configurable via `AUTOQUALITY_*` env vars. ML method is not supported. Example: `aq:dssim:0.02:60:95:0.001`.

#### Adjust — `adjust:<brightness>:<contrast>:<saturation>` (shorthand `a`)

Meta-option to set brightness, contrast, and saturation in one segment. All arguments are optional. Example: `a:50:1.2:0.8`.

#### Brightness — `brightness:<-255 to 255>` (shorthand `br`)

Adjust image brightness. 0 = no change. Example: `br:50`.

#### Contrast — `contrast:<float>` (shorthand `co`)

Adjust image contrast. 1 = no change. Example: `co:1.5`.

#### Saturation — `saturation:<float>` (shorthand `sa`)

Adjust image saturation. 1 = no change, 0 = greyscale. Example: `sa:0.5`.

#### Monochrome — `monochrome:<intensity>:<colour>` (shorthand `mc`)

Convert to monochrome. Intensity is 0–1, colour is an optional hex base colour (default `b3b3b3`). Example: `mc:1:sepia` or `mc:0.8`.

#### Duotone — `duotone:<intensity>:<colour1>:<colour2>` (shorthand `dt`)

Apply duotone effect. Intensity is 0–1, colour1 for shadows, colour2 for highlights. Example: `dt:1:000033:ffcc00`.

#### Pixelate — `pixelate:<size>` (shorthand `px`)

Apply a pixelation effect with the given block size in pixels. Example: `px:10`.

#### Unsharp Masking — `unsharp_masking:<mode>:<weight>:<divider>` (shorthand `ush`)

Advanced sharpening control. Mode: `auto` (only when downscaling, default), `always`, or `none`. Weight and divider control sharpening intensity (default weight=1, divider=24).

#### Colorize — `colorize:<opacity>:<colour>:<keep_alpha>` (shorthand `clrz` or `col`)

Apply a colour overlay. Opacity is 0–1, colour is hex (default `000`). Example: `col:0.3:ff0000`.

#### Gradient — `gradient:<opacity>:<colour>:<direction>:<start>:<stop>` (shorthand `grd` or `gr`)

Apply a gradient overlay from transparent to colour. Direction: `down` (default), `up`, `right`, `left`, or angle in degrees. Start/stop are 0–1 floats controlling gradient position. Example: `gr:0.5:000:down:0:0.5`.

#### Blur — `blur:<sigma>` (shorthand `bl`)

Gaussian blur. Example: `bl:5`.

#### Sharpen — `sharpen:<sigma>` (shorthand `sh`)

Sharpening. Example: `sh:1.5`.

#### Rotate — `rotate:<angle>` (shorthand `rot`)

Rotate by 0, 90, 180, or 270 degrees.

#### Flip — `flip:<horizontal>:<vertical>` (shorthand `fl`)

Flip the image or video. Set horizontal and/or vertical to `1` to flip along that axis. Example: `flip:1:0` (horizontal flip), `flip:0:1` (vertical flip), `flip:1:1` (both).

#### Auto Rotate — `auto_rotate:1` (shorthand `ar`)

Rotate based on EXIF orientation data. Enabled by default.

#### Background — `background:<hex>` or `background:<R>:<G>:<B>` (shorthand `bg`)

Background colour for padding and alpha flattening. Example: `bg:ff0000` or `bg:255:0:0`.

#### Background Alpha — `background_alpha:<0-1>` (shorthand `bga`)

Opacity of the background colour (0 = fully transparent, 1 = fully opaque). Example: `bga:0.5`.

#### Padding — `padding:<top>:<right>:<bottom>:<left>` (shorthand `pd`)

Extend the canvas. A single value applies uniform padding: `pd:10`.

#### Strip Metadata — `strip_metadata:1` (shorthand `sm`)

Remove EXIF and other metadata from the output. Enabled by default (controlled by `STRIP_METADATA` env var). Note: selective metadata stripping only supports EXIF metadata.

#### Keep Copyright — `keep_copyright:1` (shorthand `kcr`)

Preserve copyright metadata when stripping other metadata. Enabled by default (controlled by `KEEP_COPYRIGHT` env var). Uses exiftool to copy copyright from the source image after ffmpeg processing.

#### Strip Colour Profile — `strip_color_profile:1` (shorthand `scp`)

Strip the embedded ICC colour profile. Enabled by default (controlled by `STRIP_COLOR_PROFILE` env var).

#### Format — `format:<extension>` (shorthand `f`)

Alternative to the `@suffix` for specifying output format.

#### Framerate — `framerate:<fps>` (shorthand `fr`) — video only

Sets the output framerate. Example: `fr:30`.

#### Trim — `trim:<threshold>:<colour>:<equal_hor>:<equal_vert>` (shorthand `tr`)

Remove borders from an image using colour similarity detection. The threshold (required) controls how similar a pixel must be to the border colour to be trimmed (0–255). Optional parameters: hex colour to trim (defaults to auto-detect), `equal_hor` and `equal_vert` (1/t/true) to trim equal amounts from opposite sides. Example: `trim:10:ffffff:1:1`. Note: requires a two-pass ffmpeg analysis and increases processing time.

#### Cut — `cut:<seconds>` (shorthand `ct`) — video only

Limits output duration to the given number of seconds. Example: `ct:10`.

#### Mute — `mute:1` (shorthand `mu`) — video only

Strip audio from video output. The resulting video will have no audio track. Example: `mu:1`.

#### Enforce Thumbnail — `enforce_thumbnail:1` (shorthand `eth`)

Prefer embedded thumbnail over the full image when available. Uses exiftool for AVIF (EXIF thumbnails) and heif-thumbnailer for HEIC (container thumbnails). Falls back gracefully to the main image if no thumbnail exists. Controlled by `ENFORCE_THUMBNAIL` env var (default: false).

#### Video Thumbnail Second — `video_thumbnail_second:<seconds>` (shorthand `vts`)

Extract a single frame from a video at the given second. Used when outputting an image format from a video source. Example: `vts:5` extracts the frame at 5 seconds.

#### Video Thumbnail Keyframes — `video_thumbnail_keyframes:1` (shorthand `vtk`)

When extracting frames from video, use only keyframes. This is faster but less precise than seeking to an exact timestamp.

#### Video Thumbnail Animation — `video_thumbnail_animation:<step>:<delay>:<frames>:<frame_width>:<frame_height>` (shorthand `vta`)

Generate an animated gif or webp from video frames. Step is the interval in seconds between frames (0 = auto). Delay is the frame delay in ms (default 100). Frames limits the number of output frames. Frame width/height control output dimensions. Output format is determined by the `@gif` or `@webp` suffix. Example: `vta:0.5:100:10:200:150`.

#### DPI — `dpi:<value>`

Set the output DPI metadata. Example: `dpi:300`. Takes effect regardless of whether metadata stripping is enabled.

#### JPEG Options — `jpeg_options:<progressive>:<no_subsample>:<trellis_quant>:<overshoot_deringing>:<optimize_scans>:<quant_table>` (shorthand `jpgo`)

Format-specific JPEG encoding options. All arguments are optional booleans (1/t/true) except quant_table (integer). Example: `jpgo:1:0:1:1:1`.

#### PNG Options — `png_options:<interlaced>:<quantize>:<quantization_colours>` (shorthand `pngo`)

Format-specific PNG encoding options. Interlaced enables Adam7 interlacing, quantize enables palette mode, quantization_colours sets palette size. Example: `pngo:1:1:256`.

#### WebP Options — `webp_options:<compression>:<smart_subsample>:<preset>` (shorthand `wpo`)

Format-specific WebP encoding options. Compression is effort level (0-6), smart_subsample enables smart chroma subsampling. Example: `wpo:6:1`.

#### AVIF Options — `avif_options:<subsample>` (shorthand `avo`)

Format-specific AVIF encoding options. Subsample controls chroma subsampling (e.g. `4:2:0`, `4:4:4`). Example: `avo:4:4:4`.

#### Best Format — `format:best` or `@best`

Automatically select the most efficient image format. The service analyses image complexity (entropy) and encodes the result in multiple candidate formats, returning the smallest output.

- **Low complexity** (entropy below threshold): candidates are PNG and WebP (lossless)
- **High complexity** (entropy at or above threshold): candidates are JPEG, WebP, and AVIF

When `BEST_FORMAT_BY_DEFAULT` is enabled, best format selection is used automatically whenever no explicit output format is specified. Quality and format-specific quality (`q`, `fq`) settings are respected during the comparison.

Example: `/_/w:300/plain/https://example.com/photo.jpg@best`

#### Skip Processing — `skip_processing:<ext1>:<ext2>:...` (shorthand `skp`)

Skip all processing when the source file extension matches one of the listed formats. The source is fetched and returned as-is. Example: `skp:jpg:png` skips processing for JPEG and PNG sources.

#### Raw — `raw:1`

Return the source without any processing. The proxy fetches the source and passes it through unchanged, preserving the original content type.

#### Cache Buster — `cache_buster:<value>` (shorthand `cb`)

An ignored value used to differentiate CDN cache keys. The proxy does not use this value — it exists purely to allow cache invalidation by changing the URL. Example: `cb:v2`.

#### Expires — `expires:<timestamp>` (shorthand `exp`)

Unix timestamp after which the URL returns 404 Not Found. Used to create time-limited URLs. Example: `exp:1700000000`.

#### Filename — `filename:<name>` (shorthand `fn`)

Set the `Content-Disposition` header filename. When combined with `return_attachment`, triggers a download with the given filename. Example: `fn:photo.jpg`.

#### Return Attachment — `return_attachment:1` (shorthand `att`)

Set `Content-Disposition: attachment` on the response, prompting browsers to download rather than display inline. Combine with `filename` to control the download name.

#### Fallback Image URL — `fallback_image_url:<base64url>` (shorthand `fiu`)

Base64url-encoded URL to redirect to when processing fails. If the source cannot be fetched or processing errors out, the proxy responds with a 302 redirect to the decoded fallback URL instead of an error. Example: `fiu:aHR0cHM6Ly9leGFtcGxlLmNvbS9mYWxsYmFjay5qcGc`.

#### Hashsum — `hashsum:<type>:<hex_digest>` (shorthand `hs`)

Verify the source file's integrity by computing a checksum and comparing it to the expected digest. The type is any algorithm supported by Node.js `crypto.createHash` (e.g. `sha256`, `md5`). Returns 422 if the hash does not match. Example: `hs:sha256:abc123...`.

#### Max Source Resolution — `max_src_resolution:<megapixels>` (shorthand `msr`)

Reject the source if its resolution exceeds the given megapixel limit. Uses ffprobe to detect source dimensions before processing. Returns 422 if exceeded. Can also be set via the `MAX_SRC_RESOLUTION` env var (0 = unlimited). Example: `msr:25`.

#### Max Source File Size — `max_src_file_size:<bytes>` (shorthand `msfs`)

Reject the source if its file size exceeds the given byte limit. Checks the `Content-Length` header via a HEAD request before downloading. Returns 422 if exceeded. Can also be set via the `MAX_SRC_FILE_SIZE` env var (0 = unlimited). Example: `msfs:10485760` (10MB).

#### Max Animation Frames — `max_animation_frames:<count>` (shorthand `maf`)

Limit the number of frames in video thumbnail animations (`vta`). Returns 422 if the requested frame count exceeds the limit. Can also be set via the `MAX_ANIMATION_FRAMES` env var (0 = unlimited). Example: `maf:100`.

#### Max Animation Frame Resolution — `max_animation_frame_resolution:<megapixels>` (shorthand `mafr`)

Limit the resolution of individual animation frames. Returns 422 if the frame width × height exceeds the megapixel limit. Can also be set via the `MAX_ANIMATION_FRAME_RESOLUTION` env var (0 = unlimited). Example: `mafr:5`.

#### Max Result Dimension — `max_result_dimension:<pixels>` (shorthand `mrd`)

Limit the maximum width or height of the output. Returns 422 if either the requested width or height exceeds the limit. Can also be set via the `MAX_RESULT_DIMENSION` env var (0 = unlimited). Example: `mrd:4096`.

#### Not implemented

The following imgproxy options are recognised but return 501 Not Implemented:

- `watermark` / `wm` — watermark overlay
- `watermark_url` / `wmu` — custom watermark image URL
- `watermark_text` / `wmt` — watermark text
- `watermark_size` / `wms` — watermark dimensions
- `watermark_rotate` / `wmr` — watermark rotation
- `watermark_shadow` / `wmsh` — watermark shadow
- `style` / `st` — text style
- `objects_position` / `op` — detected object positions
- `blur_areas` / `bla` — blur specific regions
- `blur_detections` / `bd` — blur detected objects
- `draw_detections` / `dd` — draw bounding boxes on detected objects
- `gravity:sm` — smart gravity (content-aware)
- `gravity:obj` — object-oriented gravity
- `gravity:objw` — weighted object gravity
- `page` / `pg` — select page from multi-page image
- `pages` / `pgs` — number of pages to load
- `disable_animation` / `da` — disable animation
- `video_thumbnail_tile` / `vtt` — video tile sprite sheet
- `preset` / `pr` — server-side option presets

### Output format

Append a format suffix to the source URL to choose the output format:

**Video:** `@mp4` (default for video), `@webm`

- **`mp4`** — H.264 video, audio copied through
- **`webm`** — VP9 video, Opus audio

**Image:** `@jpg`, `@png`, `@webp`, `@avif`, `@gif`

- Default is `jpg` when the source is an image

### Source URLs

#### Plain HTTP(S) URLs

Use the `/plain/` prefix: `/plain/https://example.com/video.mp4`

#### Google Cloud Storage (`gs://`)

Use `gs://` URLs directly: `/plain/gs://my-bucket/path/to/video.mp4`

Authenticated via Application Default Credentials. A temporary signed URL is generated for ffmpeg.

#### Encrypted source URLs

Source URLs can be encrypted using AES-256-CBC, following the [imgproxy encrypted source URL format](https://docs.imgproxy.net/usage/encrypting_source_url):

1. Pad the source URL with PKCS#7 to 16-byte alignment
2. Generate a 16-byte IV
3. Encrypt with AES-256-CBC using the key and IV
4. Concatenate: `IV + ciphertext`
5. Encode with URL-safe Base64

Use the `/enc/` prefix instead of `/plain/` in the URL path. Requires `SOURCE_URL_ENCRYPTION_KEY` to be set.

### URL signing

URLs can be signed with HMAC-SHA256, following the [imgproxy URL signing format](https://docs.imgproxy.net/usage/signing_url). The signature is the first path segment and covers everything after it:

1. Take the path after the signature (e.g. `/resize:fill:480:360/plain/https://example.com/video.mp4`)
2. Compute HMAC-SHA256 of: `salt + path`
3. Encode the digest with URL-safe Base64

When `SIGNING_KEY` and `SIGNING_SALT` are not set, the signature segment is still required but any value is accepted.

## URL generator package

The `@socialtip/asset-proxy-url-generator` npm package generates asset-proxy-compatible URL paths programmatically. It uses the same types as the server's URL parser.

```bash
npm install @socialtip/asset-proxy-url-generator
```

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

Encrypted source URLs and signed URLs are supported via the optional second argument:

```ts
const url = generateUrl(
  { sourceUrl: "https://example.com/photo.jpg", outputFormat: "webp" },
  {
    encryptionKey: "0123456789abcdef...", // hex-encoded 32-byte key
    signingKey: "...", // hex-encoded HMAC key
    signingSalt: "...", // hex-encoded salt
  },
);
```

## Project structure

This repository is a pnpm monorepo with three packages:

| Package                                | Path                     | Published | Description                                                                        |
| -------------------------------------- | ------------------------ | --------- | ---------------------------------------------------------------------------------- |
| `@socialtip/asset-proxy-url-parser`    | `packages/url-parser`    | Yes       | Shared URL schema, parsing, signature verification/generation, and encryption      |
| `@socialtip/asset-proxy-url-generator` | `packages/url-generator` | Yes       | Generates asset-proxy-compatible URL paths with encryption and signing             |
| `proxy`                                | `packages/proxy`         | No        | The image/video processing service (Express + ffmpeg + sharp), deployed via Docker |

## Development

Requires [asdf](https://asdf-vm.com/) with the `nodejs` plugin.

```bash
asdf install        # installs Node version from .tool-versions
corepack enable     # enables pnpm
pnpm install
pnpm dev            # starts the proxy with hot reload on :8080
```

## Docker

```bash
docker build -t asset-proxy -f packages/proxy/Dockerfile .
```

### CPU only

```bash
docker run -e SKIP_GPU=1 -p 8080:8080 asset-proxy
```

### With GPU (NVIDIA)

```bash
docker run --gpus all -p 8080:8080 asset-proxy
```

Requires the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html).

## Deployment

CI/CD runs automatically on pushes to `main` and on pull requests. After tests pass, the CD job builds a Docker image and pushes it to GitHub Container Registry (`ghcr.io/socialtip/asset-proxy`). The `@socialtip/asset-proxy-url-parser` and `@socialtip/asset-proxy-url-generator` packages are published to GitHub Packages on release.

Images are tagged with the commit SHA. Pushes to `main` are additionally tagged `latest`.

## Testing

Integration tests require a running service via Docker Compose. This starts the asset-proxy container (CPU mode) alongside an nginx file server that serves test fixtures:

```bash
pnpm test:up      # start containers (builds image, waits for healthy)
pnpm test         # run all tests across all packages
pnpm test:down    # stop and remove containers
```

## Environment variables

| Variable                           | Default                               | Description                                                                                                                               |
| ---------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                             | `8080`                                | Server listen port                                                                                                                        |
| `SKIP_GPU`                         | —                                     | Set to `1` to fall back to CPU encoding. Without this, GPU is required and the process will fail if NVENC is not available.               |
| `SIGNING_KEY`                      | —                                     | Hex-encoded HMAC-SHA256 key for URL signature verification. Must be set together with `SIGNING_SALT`.                                     |
| `SIGNING_SALT`                     | —                                     | Hex-encoded salt prepended to the path before HMAC signing. Must be set together with `SIGNING_KEY`.                                      |
| `SOURCE_URL_ENCRYPTION_KEY`        | —                                     | 32-byte hex-encoded AES-256-CBC key (64 hex characters) for decrypting `/enc/` source URLs. When unset, encrypted URLs are not supported. |
| `ALLOWED_ORIGINS`                  | —                                     | Comma-separated list of allowed source URL origins (e.g. `https://example.com,gs://my-bucket`). When unset, all origins are permitted.    |
| `CACHE_CONTROL`                    | `public, max-age=31536000, immutable` | Cache-Control header value for successful responses.                                                                                      |
| `STRIP_METADATA`                   | `true`                                | Strip EXIF/IPTC metadata from output images by default.                                                                                   |
| `KEEP_COPYRIGHT`                   | `true`                                | Preserve copyright metadata when stripping. Uses exiftool to copy from source.                                                            |
| `STRIP_COLOR_PROFILE`              | `true`                                | Strip embedded ICC colour profile from output images by default.                                                                          |
| `ENFORCE_THUMBNAIL`                | `false`                               | Prefer embedded thumbnails over full image for HEIC/AVIF sources.                                                                         |
| `AUTOQUALITY_METHOD`               | `none`                                | Autoquality method: `none`, `dssim`, or `size`.                                                                                           |
| `AUTOQUALITY_TARGET`               | —                                     | Target value (DSSIM for dssim, bytes for size).                                                                                           |
| `AUTOQUALITY_MIN`                  | —                                     | Minimum quality for autoquality search.                                                                                                   |
| `AUTOQUALITY_MAX`                  | —                                     | Maximum quality for autoquality search.                                                                                                   |
| `AUTOQUALITY_ALLOWED_ERROR`        | —                                     | Allowed DSSIM deviation from target.                                                                                                      |
| `AUTOQUALITY_FORMAT_MIN`           | —                                     | Format-specific min quality, e.g. `avif=60,webp=70`.                                                                                      |
| `AUTOQUALITY_FORMAT_MAX`           | —                                     | Format-specific max quality, e.g. `avif=65,webp=80`.                                                                                      |
| `BEST_FORMAT_COMPLEXITY_THRESHOLD` | `5.5`                                 | Entropy threshold for best format selection. Below this, lossless formats are preferred; at or above, lossy formats are preferred.        |
| `BEST_FORMAT_MAX_RESOLUTION`       | `0`                                   | When > 0, skip best format testing for images exceeding this megapixel count (falls back to JPEG).                                        |
| `BEST_FORMAT_BY_DEFAULT`           | `false`                               | Automatically use best format selection when no explicit output format is specified.                                                      |
| `MAX_SRC_RESOLUTION`               | `0`                                   | Max source resolution in megapixels. 0 = unlimited.                                                                                       |
| `MAX_SRC_FILE_SIZE`                | `0`                                   | Max source file size in bytes. 0 = unlimited.                                                                                             |
| `MAX_ANIMATION_FRAMES`             | `0`                                   | Max animation frames for video thumbnail animations. 0 = unlimited.                                                                       |
| `MAX_ANIMATION_FRAME_RESOLUTION`   | `0`                                   | Max animation frame resolution in megapixels. 0 = unlimited.                                                                              |
| `MAX_RESULT_DIMENSION`             | `0`                                   | Max result width or height in pixels. 0 = unlimited.                                                                                      |

## Info endpoint

The `/info/` endpoint returns JSON metadata about a source asset (image or video) without processing it.

### URL format

```
/info/<signature>/<options>/plain/<source_url>
/info/<signature>/<options>/enc/<encrypted_source_url>
```

The path after `/info` follows the same format as processing URLs — the same signature verification, encryption, and origin checks apply. Processing options in the URL are ignored; only the source URL and security options are used.

**Example:**

```
/info/_/plain/https://example.com/photo.jpg
/info/oKfUtW34Dvo.../enc/dGhpcyBpcyBhIGJhc2U2NC...
```

### Response

Returns `application/json` with a `Cache-Control` header.

**Image response:**

```json
{
  "format": "png",
  "mime_type": "image/png",
  "width": 1920,
  "height": 1080,
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

| Field        | Type   | Description                                      |
| ------------ | ------ | ------------------------------------------------ |
| `format`     | string | Codec name (images) or container format (videos) |
| `mime_type`  | string | MIME type of the source                          |
| `width`      | number | Width in pixels                                  |
| `height`     | number | Height in pixels                                 |
| `size`       | number | File size in bytes (from `Content-Length` HEAD)  |
| `duration`   | number | Duration in seconds (video only)                 |
| `video_meta` | object | Video stream details (video only)                |

### URL generator

```ts
import { generateInfoUrl } from "@socialtip/asset-proxy-url-generator";

const url = generateInfoUrl({
  sourceUrl: "https://example.com/photo.jpg",
});
// => /info/_/plain/https://example.com/photo.jpg
```

## Health check

```
GET /health → 200 ok
```
