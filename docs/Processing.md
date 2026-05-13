# Common processing options

The following options apply equally to both image and video processing. For format-specific options, see:

- **[Image Processing](Image.md)** — resize, crop, quality, filters, format-specific encoding options, and more
- **[Video Processing](Video.md)** — resize, crop, framerate, cut, mute, thumbnail extraction, GPU acceleration, and more

## Skip Processing — `skip_processing:<ext1>:<ext2>:...` (shorthand `skp`)

Skip all processing when the source file extension matches one of the listed formats. The source is fetched and returned as-is. Example: `skp:jpg:png` skips processing for JPEG and PNG sources.

## Raw — `raw:1`

Return the source without any processing. The proxy fetches the source and passes it through unchanged, preserving the original content type.

## Cache Buster — `cache_buster:<value>` (shorthand `cb`)

An ignored value used to differentiate CDN cache keys. The proxy does not use this value — it exists purely to allow cache invalidation by changing the URL. Example: `cb:v2`.

## Expires — `expires:<timestamp>` (shorthand `exp`)

Unix timestamp after which the URL returns 404 Not Found. Used to create time-limited URLs. Example: `exp:1700000000`.

When set, the response `Cache-Control` `max-age` is capped to the remaining TTL (and `immutable` is dropped), so edge caches stop serving the response once the URL is no longer valid.

## Filename — `filename:<name>` (shorthand `fn`)

Set the `Content-Disposition` header filename. When combined with `return_attachment`, triggers a download with the given filename. Example: `fn:photo.jpg`.

## Return Attachment — `return_attachment:1` (shorthand `att`)

Set `Content-Disposition: attachment` on the response, prompting browsers to download rather than display inline. Combine with `filename` to control the download name.

## Fallback Image URL — `fallback_image_url:<base64url>` (shorthand `fiu`)

Base64url-encoded URL to redirect to when processing fails. If the source cannot be fetched or processing errors out, the proxy responds with a 302 redirect to the decoded fallback URL instead of an error. Example: `fiu:aHR0cHM6Ly9leGFtcGxlLmNvbS9mYWxsYmFjay5qcGc`.

## Hashsum — `hashsum:<type>:<hex_digest>` (shorthand `hs`)

Verify the source file's integrity by computing a checksum and comparing it to the expected digest. The type is any algorithm supported by Node.js `crypto.createHash` (e.g. `sha256`, `md5`). Returns 422 if the hash does not match. Example: `hs:sha256:abc123...`.

## Max Source Resolution — `max_src_resolution:<megapixels>` (shorthand `msr`)

Reject the source if its resolution exceeds the given megapixel limit. Uses ffprobe to detect source dimensions before processing. Returns 422 if exceeded. Can also be set via the `MAX_SRC_RESOLUTION` env var (0 = unlimited). Example: `msr:25`.

## Max Source File Size — `max_src_file_size:<bytes>` (shorthand `msfs`)

Reject the source if its file size exceeds the given byte limit. Checks the `Content-Length` header via a HEAD request before downloading. Returns 422 if exceeded. Can also be set via the `MAX_SRC_FILE_SIZE` env var (0 = unlimited). Example: `msfs:10485760` (10MB).

## Max Animation Frames — `max_animation_frames:<count>` (shorthand `maf`)

Limit the number of frames in video thumbnail animations (`vta`). Returns 422 if the requested frame count exceeds the limit. Can also be set via the `MAX_ANIMATION_FRAMES` env var (0 = unlimited). Example: `maf:100`.

## Max Animation Frame Resolution — `max_animation_frame_resolution:<megapixels>` (shorthand `mafr`)

Limit the resolution of individual animation frames. Returns 422 if the frame width × height exceeds the megapixel limit. Can also be set via the `MAX_ANIMATION_FRAME_RESOLUTION` env var (0 = unlimited). Example: `mafr:5`.

## Max Result Dimension — `max_result_dimension:<pixels>` (shorthand `mrd`)

Limit the maximum width or height of the output. Returns 422 if either the requested width or height exceeds the limit. Can also be set via the `MAX_RESULT_DIMENSION` env var (0 = unlimited). Example: `mrd:4096`.
