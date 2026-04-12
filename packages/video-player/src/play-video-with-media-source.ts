const FALLBACK_MIME = 'video/mp4; codecs="avc1.640028, mp4a.40.2"';

/**
 * Plays a video using the MediaSource API, with support for streaming even on cache miss. The source URL must use `f:fmp4` — plain mp4 is not streamable on cache miss, and webm does not require MSE.
 *
 * Uses ManagedMediaSource on iPhone Safari (17.1+), MediaSource on desktop browsers and iPad Safari, and falls back to plain `<video src>` for unsupported browsers.
 *
 * The `codec:1` (or `cdc:1`) option tells the proxy to include the codec string in the Content-Type header per RFC 6381, e.g. `video/mp4; codecs="avc1.640028, mp4a.40.2"`. The player reads this from the response headers to configure the source buffer.
 *
 */
export function playVideoWithMediaSource(
  /** The `<video>` element to play into. */
  video: HTMLVideoElement,
  /** Asset-proxy URL for the video. Must be served with CORS headers. */
  url: string,
  /** Abort signal to cancel the fetch and stop playback. */
  signal?: AbortSignal,
): void {
  if (!url.includes("cors:1")) {
    throw new Error(
      `playVideoWithMediaSource: the URL must include "cors:1" so the player ` +
        `can fetch the video with CORS headers. Received: ${url}`,
    );
  }

  if (!url.includes("codec:") && !url.includes("cdc:")) {
    throw new Error(
      `playVideoWithMediaSource: the URL must include "codec:1" (or "cdc:1") ` +
        `so the proxy exposes codec info for the MediaSource buffer. Received: ${url}`,
    );
  }

  if (!url.includes("f:fmp4")) {
    throw new Error(
      `playVideoWithMediaSource: the URL must include "f:fmp4". Plain mp4 is ` +
        `not streamable on cache miss, and webm does not require MSE. ` +
        `Received: ${url}`,
    );
  }

  const Source = pickMediaSource();

  if (!Source) {
    video.src = url;
    return;
  }

  const source = new Source();
  video.disableRemotePlayback = true;
  video.src = URL.createObjectURL(source);

  source.addEventListener("sourceopen", () => {
    const fetchAndAppend = async () => {
      let res: Response;
      try {
        res = await fetch(url, { signal });
      } catch {
        if (signal?.aborted) return;
        throw new Error(`Failed to fetch fMP4 from ${url}`);
      }
      if (!res.ok || !res.body) return;
      if (source.readyState !== "open") return;

      const contentType = res.headers.get("content-type") ?? FALLBACK_MIME;
      if (!contentType.includes("codecs=")) {
        console.warn(
          `playVideoWithMediaSource: Content-Type header does not include a ` +
            `codecs parameter (got "${contentType}"). Falling back to ` +
            `"${FALLBACK_MIME}". Ensure the URL includes "codec:1" (or "cdc:1").`,
        );
      }
      const mimeType = contentType.includes("codecs=")
        ? contentType
        : FALLBACK_MIME;

      const buf = source.addSourceBuffer(mimeType);
      const reader = res.body.getReader();

      const appendChunk = (chunk: Uint8Array) =>
        new Promise<void>((resolve) => {
          buf.appendBuffer(chunk as unknown as BufferSource);
          if (buf.updating) {
            buf.addEventListener("updateend", () => resolve(), { once: true });
          } else {
            resolve();
          }
        });

      let started = false;
      while (true) {
        if (signal?.aborted) {
          await reader.cancel();
          return;
        }
        const { done, value } = await reader.read();
        if (done) break;
        await appendChunk(value);
        if (!started) {
          started = true;
          video.play().catch(() => {});
        }
      }

      if (source.readyState === "open") source.endOfStream();
    };

    if ("streaming" in source) {
      source.addEventListener("startstreaming", () => fetchAndAppend());
    } else {
      fetchAndAppend();
    }
  });
}

declare global {
  interface Window {
    ManagedMediaSource?: typeof MediaSource;
  }
}

function pickMediaSource(): typeof MediaSource | null {
  if (
    window.ManagedMediaSource &&
    window.ManagedMediaSource.isTypeSupported(FALLBACK_MIME)
  ) {
    return window.ManagedMediaSource;
  }

  if ("MediaSource" in window && MediaSource.isTypeSupported(FALLBACK_MIME)) {
    return MediaSource;
  }

  return null;
}
