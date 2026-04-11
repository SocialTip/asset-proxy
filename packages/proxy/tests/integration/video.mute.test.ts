import { generateUrl } from "@socialtip/asset-proxy-url-generator";
import { parseProcessingUrl } from "@socialtip/asset-proxy-url-parser";

import { h2Fetch as fetch, URL_CONFIG } from "./setup.js";
import {
  probeCodecs,
  SERVICE_URL,
  VIDEO_NOAUDIO_SOURCE_URL,
  VIDEO_SOURCE_URL,
} from "./video-helpers.js";

function parseCodecs(contentType: string): string[] {
  const match = contentType.match(/codecs="([^"]+)"/);
  return match ? match[1].split(",").map((c) => c.trim()) : [];
}

describe("video mute", () => {
  it("muted mp4 has no audio codec in content-type or output", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/resize:fill:128:128/fr:15/ct:1/mu:1/plain/${VIDEO_SOURCE_URL}`,
    );
    const url = `${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`;
    const res = await fetch(url);

    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type")!;
    expect(contentType).toMatchInlineSnapshot(
      `"video/mp4; codecs="avc1.64000a""`,
    );
    expect(parseCodecs(contentType)).toHaveLength(1);

    const buffer = Buffer.from(await res.arrayBuffer());
    const actualCodecs = await probeCodecs(buffer);
    expect(actualCodecs).toHaveLength(1);
    for (const codec of parseCodecs(contentType)) {
      expect(actualCodecs).toContain(codec);
    }
  });

  it("muted fmp4 has no audio codec in content-type or output", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/resize:fill:128:128/fr:15/ct:1/mu:1/plain/${VIDEO_SOURCE_URL}@fmp4`,
    );
    const url = `${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`;
    const res = await fetch(url);

    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type")!;
    expect(contentType).toMatchInlineSnapshot(
      `"video/mp4; codecs="avc1.64000a""`,
    );
    expect(parseCodecs(contentType)).toHaveLength(1);

    const buffer = Buffer.from(await res.arrayBuffer());
    const actualCodecs = await probeCodecs(buffer);
    expect(actualCodecs).toHaveLength(1);
    for (const codec of parseCodecs(contentType)) {
      expect(actualCodecs).toContain(codec);
    }
  });

  it("muted webm has no audio codec in content-type or output", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/resize:fill:128:128/fr:15/ct:1/mu:1/plain/${VIDEO_SOURCE_URL}@webm`,
    );
    const url = `${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`;
    const res = await fetch(url);

    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type")!;
    expect(contentType).toMatchInlineSnapshot(
      `"video/webm; codecs="av01.0.00M.08""`,
    );
    expect(parseCodecs(contentType)).toHaveLength(1);

    const buffer = Buffer.from(await res.arrayBuffer());
    const actualCodecs = await probeCodecs(buffer);
    expect(actualCodecs).toHaveLength(1);
    for (const codec of parseCodecs(contentType)) {
      expect(actualCodecs).toContain(codec);
    }
  });

  it("source without audio track omits audio codec", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/resize:fill:128:128/fr:15/ct:1/plain/${VIDEO_NOAUDIO_SOURCE_URL}@mp4`,
    );
    const url = `${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`;
    const res = await fetch(url);

    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type")!;
    expect(contentType).toMatchInlineSnapshot(
      `"video/mp4; codecs="avc1.64000a""`,
    );
    expect(parseCodecs(contentType)).toHaveLength(1);

    const buffer = Buffer.from(await res.arrayBuffer());
    const actualCodecs = await probeCodecs(buffer);
    expect(actualCodecs).toHaveLength(1);
    for (const codec of parseCodecs(contentType)) {
      expect(actualCodecs).toContain(codec);
    }
  });
});
