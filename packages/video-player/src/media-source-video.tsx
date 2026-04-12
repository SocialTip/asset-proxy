import {
  type ComponentProps,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import { playVideoWithMediaSource } from "./play-video-with-media-source.js";

/**
 * Renders a video using the MediaSource API, with support for streaming even on cache miss. The source URL should use `f:fmp4` to enable cache-miss streaming.
 *
 * Uses ManagedMediaSource on iPhone Safari (17.1+), MediaSource on desktop browsers and iPad Safari, and falls back to plain `<video src>` when neither is available.
 */
export function MediaSourceVideo({
  src,
  ref,
  ...videoProps
}: Omit<ComponentProps<"video">, "src"> & {
  /** Asset-proxy URL for the video. Must include `cors:1` and `codec:1` (or `cdc:1`). */
  src: string;
  ref?: Ref<HTMLVideoElement>;
}) {
  const internalRef = useRef<HTMLVideoElement>(null);
  useImperativeHandle(ref, () => internalRef.current!, []);

  useEffect(() => {
    const controller = new AbortController();
    if (internalRef.current) {
      playVideoWithMediaSource(internalRef.current, src, controller.signal);
    }
    return () => controller.abort();
  }, [src]);

  return <video ref={internalRef} {...videoProps} />;
}
