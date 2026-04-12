import { Storage } from "@google-cloud/storage";
import { generateUrl } from "@socialtip/asset-proxy-url-generator";
import { parseProcessingUrl } from "@socialtip/asset-proxy-url-parser";

import { CACHE_PROXY_URL, h2Fetch as fetch, URL_CONFIG } from "./setup.js";
import {
  probeCodecs,
  VIDEO_LC_SOURCE_URL,
  VIDEO_NOAUDIO_SOURCE_URL,
  VIDEO_SOURCE_URL,
  WEBM_SOURCE_URL,
} from "./video-helpers.js";

const FAKE_GCS_URL = process.env.FAKE_GCS_URL ?? "http://localhost:4443";
const gcs = new Storage({ apiEndpoint: FAKE_GCS_URL });
const bucket = gcs.bucket("test-cache");

const CACHE_BUSTER = "codec-test";

function parseCodecs(contentType: string): string[] {
  const match = contentType.match(/codecs="([^"]+)"/);
  return match ? match[1].split(",").map((c) => c.trim()) : [];
}

async function clearOwnCacheEntries(): Promise<void> {
  const [files] = await bucket.getFiles();
  await Promise.all(
    files
      .filter((f) => f.name.includes(`cb:${CACHE_BUSTER}`))
      .map((f) => f.delete()),
  );
}

async function waitForCacheWrite(urlPath: string): Promise<void> {
  const key = urlPath.startsWith("/") ? urlPath.slice(1) : urlPath;
  const file = bucket.file(key);
  await vi.waitFor(async () => {
    const [exists] = await file.exists();
    expect(exists).toBe(true);
  });
}

describe("video codec", () => {
  beforeEach(async () => {
    await clearOwnCacheEntries();
  });

  it("mp4 has correct codec header and survives cache round-trip", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/cb:${CACHE_BUSTER}/fr:15/ct:1/cdc:1/plain/${VIDEO_SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);

    const res1 = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res1.status).toBe(200);
    const contentType1 = res1.headers.get("content-type")!;
    expect(contentType1).toMatchInlineSnapshot(
      `"video/mp4; codecs="avc1.640016, mp4a.40.5""`,
    );

    const buffer = Buffer.from(await res1.arrayBuffer());
    const actualCodecs = await probeCodecs(buffer);
    for (const codec of parseCodecs(contentType1)) {
      expect(actualCodecs).toContain(codec);
    }

    await waitForCacheWrite(urlPath);

    const res2 = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res2.status).toBe(200);
    expect(res2.headers.get("accept-ranges")).toBe("bytes");
    expect(res2.headers.get("content-type")).toBe(contentType1);
  });

  it("fmp4 has correct codec header and survives cache round-trip", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/cb:${CACHE_BUSTER}/fr:15/ct:1/cdc:1/cors:1/plain/${VIDEO_SOURCE_URL}@fmp4`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);

    const res1 = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res1.status).toBe(200);
    const contentType1 = res1.headers.get("content-type")!;
    expect(contentType1).toMatchInlineSnapshot(
      `"video/mp4; codecs="avc1.640016, mp4a.40.5""`,
    );
    expect(res1.headers.get("access-control-allow-origin")).toBe("*");

    const buffer = Buffer.from(await res1.arrayBuffer());
    const actualCodecs = await probeCodecs(buffer);
    for (const codec of parseCodecs(contentType1)) {
      expect(actualCodecs).toContain(codec);
    }

    await waitForCacheWrite(urlPath);

    const res2 = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res2.status).toBe(200);
    expect(res2.headers.get("accept-ranges")).toBe("bytes");
    expect(res2.headers.get("content-type")).toBe(contentType1);
    expect(res2.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("fmp4 omits CORS header without cors option", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/cb:${CACHE_BUSTER}/fr:15/ct:1/cdc:1/plain/${VIDEO_SOURCE_URL}@fmp4`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);

    const res = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("mp4 from webm source re-encodes audio to aac", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/cb:${CACHE_BUSTER}/fr:15/ct:1/cdc:1/plain/${WEBM_SOURCE_URL}@mp4`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);

    const res1 = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res1.status).toBe(200);
    const contentType1 = res1.headers.get("content-type")!;
    expect(contentType1).toMatchInlineSnapshot(
      `"video/mp4; codecs="avc1.640016, mp4a.40.2""`,
    );

    const buffer = Buffer.from(await res1.arrayBuffer());
    const actualCodecs = await probeCodecs(buffer);
    for (const codec of parseCodecs(contentType1)) {
      expect(actualCodecs).toContain(codec);
    }

    await waitForCacheWrite(urlPath);

    const res2 = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res2.status).toBe(200);
    expect(res2.headers.get("accept-ranges")).toBe("bytes");
    expect(res2.headers.get("content-type")).toBe(contentType1);
  });

  it("mp4 from AAC-LC source has correct audio codec", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/cb:${CACHE_BUSTER}/fr:15/ct:1/cdc:1/plain/${VIDEO_LC_SOURCE_URL}@mp4`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);

    const res1 = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res1.status).toBe(200);
    const contentType1 = res1.headers.get("content-type")!;
    expect(contentType1).toMatchInlineSnapshot(
      `"video/mp4; codecs="avc1.640016, mp4a.40.2""`,
    );

    const buffer = Buffer.from(await res1.arrayBuffer());
    const actualCodecs = await probeCodecs(buffer);
    for (const codec of parseCodecs(contentType1)) {
      expect(actualCodecs).toContain(codec);
    }

    await waitForCacheWrite(urlPath);

    const res2 = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res2.status).toBe(200);
    expect(res2.headers.get("accept-ranges")).toBe("bytes");
    expect(res2.headers.get("content-type")).toBe(contentType1);
  });

  it("webm has av1 video and opus audio", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/cb:${CACHE_BUSTER}/fr:15/ct:1/cdc:1/plain/${VIDEO_SOURCE_URL}@webm`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);

    const res1 = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res1.status).toBe(200);
    const contentType1 = res1.headers.get("content-type")!;
    expect(contentType1).toMatchInlineSnapshot(
      `"video/webm; codecs="av01.0.01M.08, opus""`,
    );

    const buffer = Buffer.from(await res1.arrayBuffer());
    const actualCodecs = await probeCodecs(buffer);
    for (const codec of parseCodecs(contentType1)) {
      expect(actualCodecs).toContain(codec);
    }

    await waitForCacheWrite(urlPath);

    const res2 = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res2.status).toBe(200);
    expect(res2.headers.get("accept-ranges")).toBe("bytes");
    expect(res2.headers.get("content-type")).toBe(contentType1);
  });

  it("webm from webm source passes opus audio through", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/cb:${CACHE_BUSTER}/fr:15/ct:1/cdc:1/plain/${WEBM_SOURCE_URL}@webm`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);

    const res = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type")!;
    expect(contentType).toMatchInlineSnapshot(
      `"video/webm; codecs="av01.0.01M.08, opus""`,
    );

    const buffer = Buffer.from(await res.arrayBuffer());
    const actualCodecs = await probeCodecs(buffer);
    for (const codec of parseCodecs(contentType)) {
      expect(actualCodecs).toContain(codec);
    }
  });

  it("omits codec from content-type without codec flag", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/cb:${CACHE_BUSTER}/fr:15/ct:1/plain/${VIDEO_SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);

    const res = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
  });

  it("re-encodes non-AAC audio to AAC even without codec flag", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/cb:${CACHE_BUSTER}/fr:15/ct:1/plain/${WEBM_SOURCE_URL}@mp4`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);

    const res = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");

    const buffer = Buffer.from(await res.arrayBuffer());
    const actualCodecs = await probeCodecs(buffer);
    expect(actualCodecs).toContain("mp4a.40.2");
  });

  describe("muted", () => {
    it("source without audio track (encoded as mp4) omits audio codec", async () => {
      const parsed = parseProcessingUrl(
        `/insecure/cb:${CACHE_BUSTER}/fr:15/ct:1/cdc:1/plain/${VIDEO_NOAUDIO_SOURCE_URL}@mp4`,
      );
      const urlPath = generateUrl(parsed, URL_CONFIG);

      const res = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
      expect(res.status).toBe(200);
      const contentType = res.headers.get("content-type")!;
      expect(contentType).toMatchInlineSnapshot(
        `"video/mp4; codecs="avc1.640016""`,
      );
      expect(parseCodecs(contentType)).toHaveLength(1);

      const buffer = Buffer.from(await res.arrayBuffer());
      const actualCodecs = await probeCodecs(buffer);
      expect(actualCodecs).toHaveLength(1);
      for (const codec of parseCodecs(contentType)) {
        expect(actualCodecs).toContain(codec);
      }
    });

    it("source without audio track (encoded as webm) omits audio codec", async () => {
      const parsed = parseProcessingUrl(
        `/insecure/cb:${CACHE_BUSTER}/fr:15/ct:1/cdc:1/plain/${VIDEO_NOAUDIO_SOURCE_URL}@webm`,
      );
      const urlPath = generateUrl(parsed, URL_CONFIG);

      const res = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
      expect(res.status).toBe(200);
      const contentType = res.headers.get("content-type")!;
      expect(contentType).toMatchInlineSnapshot(
        `"video/webm; codecs="av01.0.01M.08""`,
      );
      expect(parseCodecs(contentType)).toHaveLength(1);

      const buffer = Buffer.from(await res.arrayBuffer());
      const actualCodecs = await probeCodecs(buffer);
      expect(actualCodecs).toHaveLength(1);
      for (const codec of parseCodecs(contentType)) {
        expect(actualCodecs).toContain(codec);
      }
    });

    it("muted mp4 has no audio codec", async () => {
      const parsed = parseProcessingUrl(
        `/insecure/cb:${CACHE_BUSTER}/fr:15/ct:1/mu:1/cdc:1/plain/${VIDEO_SOURCE_URL}`,
      );
      const urlPath = generateUrl(parsed, URL_CONFIG);

      const res = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
      expect(res.status).toBe(200);
      const contentType = res.headers.get("content-type")!;
      expect(contentType).toMatchInlineSnapshot(
        `"video/mp4; codecs="avc1.640016""`,
      );
      expect(parseCodecs(contentType)).toHaveLength(1);

      const buffer = Buffer.from(await res.arrayBuffer());
      const actualCodecs = await probeCodecs(buffer);
      expect(actualCodecs).toHaveLength(1);
      expect(actualCodecs.every((c) => !c.startsWith("mp4a."))).toBe(true);
      for (const codec of parseCodecs(contentType)) {
        expect(actualCodecs).toContain(codec);
      }
    });

    it("muted fmp4 has no audio codec", async () => {
      const parsed = parseProcessingUrl(
        `/insecure/cb:${CACHE_BUSTER}/fr:15/ct:1/mu:1/cdc:1/plain/${VIDEO_SOURCE_URL}@fmp4`,
      );
      const urlPath = generateUrl(parsed, URL_CONFIG);

      const res = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
      expect(res.status).toBe(200);
      const contentType = res.headers.get("content-type")!;
      expect(contentType).toMatchInlineSnapshot(
        `"video/mp4; codecs="avc1.640016""`,
      );
      expect(parseCodecs(contentType)).toHaveLength(1);

      const buffer = Buffer.from(await res.arrayBuffer());
      const actualCodecs = await probeCodecs(buffer);
      expect(actualCodecs).toHaveLength(1);
      expect(actualCodecs.every((c) => !c.startsWith("mp4a."))).toBe(true);
      for (const codec of parseCodecs(contentType)) {
        expect(actualCodecs).toContain(codec);
      }
    });

    it("muted webm has no audio codec", async () => {
      const parsed = parseProcessingUrl(
        `/insecure/cb:${CACHE_BUSTER}/fr:15/ct:1/mu:1/cdc:1/plain/${VIDEO_SOURCE_URL}@webm`,
      );
      const urlPath = generateUrl(parsed, URL_CONFIG);

      const res = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
      expect(res.status).toBe(200);
      const contentType = res.headers.get("content-type")!;
      expect(contentType).toMatchInlineSnapshot(
        `"video/webm; codecs="av01.0.01M.08""`,
      );
      expect(parseCodecs(contentType)).toHaveLength(1);

      const buffer = Buffer.from(await res.arrayBuffer());
      const actualCodecs = await probeCodecs(buffer);
      expect(actualCodecs).toHaveLength(1);
      expect(actualCodecs).not.toContain("opus");
      for (const codec of parseCodecs(contentType)) {
        expect(actualCodecs).toContain(codec);
      }
    });
  });
});
