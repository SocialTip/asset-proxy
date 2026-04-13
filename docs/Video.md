# Video Processing

An overview of all processing options available when outputting a video format. The service automatically detects whether to use image or video processing based on the output format suffix and source URL extension.

See also: [Image Processing](Image.md), [Metadata](Metadata.md)

## Output formats

Append a format suffix to the source URL to choose the output format:

| Format | Suffix  | Notes                                                                                                                                                                                                                                                                                                    |
| ------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MP4    | `@mp4`  | H.264 video, audio copied through. Default for video output.                                                                                                                                                                                                                                             |
| fMP4   | `@fmp4` | Fragmented MP4 — same H.264 codecs as MP4 but streams without buffering. Requires [MSE](https://developer.mozilla.org/en-US/docs/Web/API/MediaSource) or [ManagedMediaSource](https://developer.mozilla.org/en-US/docs/Web/API/ManagedMediaSource) for playback; does not work as a plain `<video src>`. |
| WebM   | `@webm` | AV1 video, Opus audio                                                                                                                                                                                                                                                                                    |

`format:best` (or `@best`) always resolves to MP4 for video output. While WebM with AV1 offers better compression and streaming characteristics, Apple devices lack reliable WebM playback support, making MP4 with H.264 the safest choice for broad compatibility.

**fMP4 vs MP4:** Regular MP4 requires the entire file to be encoded before the `moov` atom can be placed at the start (`faststart`), resulting in higher initial latency on cache misses. Fragmented MP4 streams immediately using `empty_moov` and `frag_keyframe`, avoiding the buffering step. The trade-off is that fMP4 cannot be played via a plain `<video src>` — it requires a JavaScript player using the MediaSource or ManagedMediaSource API.

**Codec signalling:** When the `codec:1` option is present, video responses include the codec string in the `Content-Type` header per [RFC 6381](https://www.rfc-editor.org/rfc/rfc6381), e.g. `video/mp4; codecs="avc1.640028, mp4a.40.2"`. This allows MSE players to configure the source buffer without hardcoding codec assumptions. Without `codec:1`, the `Content-Type` is the plain MIME type (e.g. `video/mp4`). Audio is always AAC for MP4/fMP4 (passthrough if the source is AAC, re-encoded otherwise) and Opus for WebM. See [Codec](#codec--codec1-shorthand-cdc).

**CORS:** MSE playback requires fetching the video via JavaScript (`fetch` / `XMLHttpRequest`). When the player and the asset proxy are on different origins, browsers block the response unless it includes the `Access-Control-Allow-Origin` header. Add `cors:1` to the URL to include this header. See [CORS](#cors--cors1).

You can also extract a still image from a video by using an image format suffix (`@jpg`, `@png`, etc.). See [Video Thumbnail Second](#video-thumbnail-second--video_thumbnail_secondseconds-shorthand-vts) for controlling which frame is extracted.

**Examples:**

```
/_/resize:fill:480:360/plain/https://example.com/my-video.mp4
/_/resize:fill:480:360/fr:30/ct:10/plain/https://example.com/my-video.mp4@webm
/_/vts:5/plain/https://example.com/my-video.mp4@jpg
```

## Processing options

Options are path segments between the signature and the source URL. Compatible with the [imgproxy processing API](https://docs.imgproxy.net/usage/processing).

### Resize — `resize:<type>:<width>:<height>` (shorthand `rs`)

| Type        | Behaviour                                                      |
| ----------- | -------------------------------------------------------------- |
| `fit`       | Scale to fit within the box, preserving aspect ratio (default) |
| `fill`      | Scale to cover the box, cropping the excess                    |
| `fill-down` | Like `fill`, but never upscales                                |
| `force`     | Stretch to exact dimensions, ignoring aspect ratio             |
| `auto`      | Uses `fill` when orientations match, otherwise `fit`           |

### Size — `size:<width>:<height>` (shorthand `s`)

Shorthand for setting width and height without specifying resize type (defaults to `fit`).

### Width / Height — `width:<w>` (`w`) / `height:<h>` (`h`)

Set dimensions individually. When used without a `resize` segment, defaults to `fit`.

### Resizing Type — `resizing_type:<type>` (shorthand `t`, `rt`)

Override the resize type without specifying dimensions. Accepts the same values as the type in `resize` (`fit`, `fill`, `fill-down`, `force`, `auto`). Useful when width/height are set separately via `w:` / `h:`.

### Resizing Algorithm — `resizing_algorithm:<algorithm>` (shorthand `ra`)

Controls the scaling algorithm. Supports CPU and GPU modes:

**CPU algorithms** (for video thumbnails): `nearest`, `linear`, `cubic`, `lanczos2`, `lanczos3`. Example: `ra:lanczos3`.

**GPU scalers** (video processing with GPU acceleration only): `gpu:scale_cuda`, `gpu:scale_npp`, `gpu:cuvid`. The `scale_npp` scaler also supports an interpolation algorithm suffix: `gpu:scale_npp:cubic`, `gpu:scale_npp:lanczos3`, etc. Available `scale_npp` interpolation algorithms: `nearest`, `linear`, `cubic`, `lanczos2`, `lanczos3`. The `cuvid` scaler uses the decoder-level `-resize` flag instead of a filter-based scaler, which may offer better performance for simple resize operations. Note: `cuvid` only supports `force` resize type (no aspect-ratio-aware resizing).

### Min Width / Min Height — `min_width:<w>` (`mw`) / `min_height:<h>` (`mh`)

Ensure the output is at least the specified width or height, upscaling if necessary while preserving aspect ratio.

### Zoom — `zoom:<factor>` or `zoom:<x>:<y>` (shorthand `z`)

Multiply resize dimensions by the given factor. Example: `z:2` doubles the output size. Supports separate x/y factors: `z:2:1.5`.

### DPR — `dpr:<ratio>`

Device pixel ratio — multiplies dimensions and padding. Example: `dpr:2`.

### Enlarge — `enlarge:1` (shorthand `el`)

Allow upscaling when the video is smaller than the target dimensions. Off by default.

### Crop — `crop:<width>:<height>:<gravity>` (shorthand `c`)

Extract a region before resizing. Values less than 1 are treated as relative to source dimensions.

### Crop Aspect Ratio — `crop_aspect_ratio:<width>:<height>` (shorthand `car`)

Crop the video to the given aspect ratio before any other processing. Example: `car:16:9`, `car:1:1`.

### Gravity — `gravity:<type>` (shorthand `g`)

Anchor point for crop operations.

**Compass gravity:** `no` (north), `so` (south), `ea` (east), `we` (west), `noea`, `nowe`, `soea`, `sowe`, `ce` (centre).

**Focus point gravity:** `fp:<x>:<y>` where x and y are floats between 0 and 1 representing the focus point. Example: `g:fp:0.3:0.7`. The crop window is centred on the focus point, clamped to video bounds.

### Quality — `quality:<1-100>` (shorthand `q`)

Output quality for lossy encoding. When not specified, falls back to the `FORMAT_QUALITY` and `QUALITY` environment variables (see [Configuration](Configuration.md)).

### Format Quality — `format_quality:<fmt1>:<q1>:<fmt2>:<q2>` (shorthand `fq`)

Per-format quality overrides. Overrides the global `quality` setting for specific formats.

### Adjust — `adjust:<brightness>:<contrast>:<saturation>` (shorthand `a`)

Meta-option to set brightness, contrast, and saturation in one segment. All arguments are optional. Example: `a:50:1.2:0.8`.

### Brightness — `brightness:<-255 to 255>` (shorthand `br`)

Adjust video brightness. 0 = no change. Example: `br:50`.

### Contrast — `contrast:<float>` (shorthand `co`)

Adjust video contrast. 1 = no change. Example: `co:1.5`.

### Saturation — `saturation:<float>` (shorthand `sa`)

Adjust video saturation. 1 = no change, 0 = greyscale. Example: `sa:0.5`.

### Blur — `blur:<sigma>` (shorthand `bl`)

Gaussian blur. Example: `bl:5`.

### Sharpen — `sharpen:<sigma>` (shorthand `sh`)

Sharpening. Example: `sh:1.5`.

### Rotate — `rotate:<angle>` (shorthand `rot`)

Rotate by 0, 90, 180, or 270 degrees.

### Flip — `flip:<horizontal>:<vertical>` (shorthand `fl`)

Flip the video. Set horizontal and/or vertical to `1` to flip along that axis. Example: `flip:1:0` (horizontal flip), `flip:0:1` (vertical flip), `flip:1:1` (both).

### Background — `background:<hex>` or `background:<R>:<G>:<B>` (shorthand `bg`)

Background colour for padding. Example: `bg:ff0000` or `bg:255:0:0`.

### Background Alpha — `background_alpha:<0-1>` (shorthand `bga`)

Opacity of the background colour (0 = fully transparent, 1 = fully opaque). Example: `bga:0.5`.

### Padding — `padding:<top>:<right>:<bottom>:<left>` (shorthand `pd`)

Extend the canvas. A single value applies uniform padding: `pd:10`.

### Strip Metadata — `strip_metadata:1` (shorthand `sm`)

Remove metadata from the output. Enabled by default (controlled by `STRIP_METADATA` env var).

### Keep Copyright — `keep_copyright:1` (shorthand `kcr`)

Preserve copyright metadata when stripping other metadata. Enabled by default (controlled by `KEEP_COPYRIGHT` env var).

### Format — `format:<extension>` (shorthand `f`)

Alternative to the `@suffix` for specifying output format.

## Video-specific options

### Framerate — `framerate:<fps>` (shorthand `fr`)

Sets the output framerate. Example: `fr:30`.

### Cut — `cut:<seconds>` (shorthand `ct`)

Limits output duration to the given number of seconds. Example: `ct:10`.

### Mute — `mute:1` (shorthand `mu`)

Strip audio from video output. The resulting video will have no audio track. Example: `mu:1`.

### Codec — `codec:1` (shorthand `cdc`)

Include the [RFC 6381](https://www.rfc-editor.org/rfc/rfc6381) codec string in the `Content-Type` response header for video output. When enabled, the response includes e.g. `video/mp4; codecs="avc1.640028, mp4a.40.2"` instead of plain `video/mp4`. Clients using [MSE](https://developer.mozilla.org/en-US/docs/Web/API/MediaSource) or [ManagedMediaSource](https://developer.mozilla.org/en-US/docs/Web/API/ManagedMediaSource) with fMP4 should specify this option to configure source buffers correctly. Example: `cdc:1`.

### CORS — `cors:1`

Include `Access-Control-Allow-Origin: *` in the response. This is required when using MSE (MediaSource or ManagedMediaSource) to play video cross-origin, since MSE fetches the stream via JavaScript and the browser enforces CORS on the response. This option works for all media types, not just video. Example: `cors:1`.

### Video Thumbnail Second — `video_thumbnail_second:<seconds>` (shorthand `vts`)

Extract a single frame from a video at the given second. Used when outputting an image format from a video source. Example: `vts:5` extracts the frame at 5 seconds.

### Video Thumbnail Keyframes — `video_thumbnail_keyframes:1` (shorthand `vtk`)

When extracting frames from video, use only keyframes. This is faster but less precise than seeking to an exact timestamp.

### Video Thumbnail Animation — `video_thumbnail_animation:<step>:<delay>:<frames>:<frame_width>:<frame_height>:<extend_frame>:<trim>:<fill>:<focus_x>:<focus_y>` (shorthand `vta`)

Generate an animated gif or webp from video frames. Step is the interval in seconds between frames (0 = auto). Delay is the frame delay in ms (default 100). Frames limits the number of output frames. Frame width/height control output dimensions (default behaviour fits within the box preserving aspect ratio). Set `fill` to 1 to crop-fill to exact dimensions instead. Set `extend_frame` to 1 to pad with black to exact dimensions. `focus_x` and `focus_y` (0–1, default 0.5) control the crop anchor when fill is active. Output format is determined by the `@gif` or `@webp` suffix. Example: `vta:0.5:100:10:200:150` (fit), `vta:0.5:100:10:200:150:0:0:1` (fill).

## GPU acceleration

Video processing supports optional NVIDIA GPU acceleration via NVENC. GPU is only used for video outputs (MP4/WebM). Image outputs — including video thumbnails extracted with `vts` — are always processed on CPU regardless of GPU availability.

Set `SKIP_GPU=1` to fall back to CPU encoding for all video output. When GPU is available, specify a GPU scaler via the `resizing_algorithm` option to use GPU-accelerated resize — see [Resizing Algorithm](#resizing-algorithm--resizing_algorithmalgorithm-shorthand-ra).

`GPU_CONCURRENCY` (default `1`) controls the maximum number of concurrent GPU ffmpeg processes. NVIDIA consumer cards typically support 3–5 concurrent NVENC sessions; increase this value based on your hardware. Requests that exceed the limit will queue until a slot becomes available.

## Not implemented

The following imgproxy options are recognised but return 501 Not Implemented:

- `video_thumbnail_tile` / `vtt` — video tile sprite sheet
- `preset` / `pr` — server-side option presets
