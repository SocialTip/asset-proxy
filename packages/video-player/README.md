# @socialtip/asset-proxy-video-player

MediaSource video player for [asset-proxy](https://github.com/SocialTip/asset-proxy). Streams video via the MediaSource API with support for cache-miss streaming, and falls back to plain `<video src>` on unsupported browsers.

## Browser support

- **ManagedMediaSource** on iPhone Safari (17.1+)
- **MediaSource** on desktop browsers and iPad Safari
- **Plain `<video src>` fallback** when neither is available

## Installation

```bash
npm install @socialtip/asset-proxy-video-player
```

## Usage

### Imperative (no framework)

```ts
import { playVideoWithMediaSource } from "@socialtip/asset-proxy-video-player";

const video = document.querySelector("video")!;
const controller = new AbortController();

playVideoWithMediaSource(
  video,
  "/cors:1/codec:avc1/f:fmp4/video.mp4",
  controller.signal,
);
```

### React component

Requires `react` as a peer dependency.

```tsx
import { MediaSourceVideo } from "@socialtip/asset-proxy-video-player/react";

<MediaSourceVideo
  src="/cors:1/codec:avc1/f:fmp4/video.mp4"
  autoPlay
  muted
  loop
/>;
```

## URL requirements

The source URL must include:

- **`cors:1`** — enables CORS headers so the player can fetch the video
- **`codec:` or `cdc:`** — includes codec info in the Content-Type header, used to configure the MediaSource buffer

The source URL should use **`f:fmp4`** to enable cache-miss streaming.
