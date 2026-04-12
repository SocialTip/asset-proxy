import { Storage } from "@google-cloud/storage";
import {
  generateInfoUrl,
  generateUrl,
} from "@socialtip/asset-proxy-url-generator";
import { parseProcessingUrl } from "@socialtip/asset-proxy-url-parser";

import { SOURCE_URL, toPng } from "./helpers.js";
import { CACHE_PROXY_URL, h2Fetch as fetch, URL_CONFIG } from "./setup.js";
import { VIDEO_SOURCE_URL } from "./video-helpers.js";

const FAKE_GCS_URL = process.env.FAKE_GCS_URL ?? "http://localhost:4443";
const gcs = new Storage({ apiEndpoint: FAKE_GCS_URL });
const bucket = gcs.bucket("test-cache");

const CACHE_BUSTER = "cache-test";

async function fetchCachedObject(urlPath: string): Promise<Buffer> {
  const [contents] = await bucket.file(urlPath).download();
  return contents;
}

async function waitForCacheWrite(urlPath: string): Promise<void> {
  const key = urlPath.startsWith("/") ? urlPath.slice(1) : urlPath;
  const file = bucket.file(key);
  await vi.waitFor(async () => {
    const [exists] = await file.exists();
    expect(exists).toBe(true);
  });
}

async function clearOwnCacheEntries(): Promise<void> {
  const [files] = await bucket.getFiles();
  await Promise.all(
    files
      .filter((f) => f.name.includes(`cb:${CACHE_BUSTER}`))
      .map((f) => f.delete()),
  );
}

beforeEach(async () => {
  await clearOwnCacheEntries();
});

describe("cache proxy", () => {
  it("forwards to processing proxy on cache miss and caches the result", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/cb:${CACHE_BUSTER}/rs:fit:100:100/plain/${SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);
    const res = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const responseBuffer = Buffer.from(await res.arrayBuffer());

    await waitForCacheWrite(urlPath);

    expect(urlPath).toMatchInlineSnapshot(
      `"/DgBSiDeCcr6Egllmc0dbiFDMe8j3ZmlAvTDKaG8Buos/cb:cache-test/f:jpg/rs:fit:100:100/enc/NzMyYzQzZGJhYjk5ZDBlZtBKi-Id0FYxlGQ7-9wXDkM3s2zCBr3Da1CfeTUcMhYe03RhgH0EO99c6crVLSXM_A"`,
    );

    const cachedBuffer = await fetchCachedObject(urlPath.slice(1));
    expect(cachedBuffer).toEqual(responseBuffer);
    expect(await toPng(cachedBuffer)).toMatchImageSnapshot();
  });

  it("serves from cache on cache hit", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/cb:${CACHE_BUSTER}/rs:fit:100:100/plain/${SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);

    const res1 = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res1.status).toBe(200);

    await waitForCacheWrite(urlPath);

    // Overwrite the cached object with sentinel content to prove the next request reads from the bucket
    const key = urlPath.slice(1);
    const file = bucket.file(key);
    await file.save(Buffer.from("sentinel"), {
      contentType: "text/plain",
      resumable: false,
    });

    const res2 = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res2.status).toBe(200);
    expect(res2.headers.get("content-type")).toBe("text/plain");
    const body = await res2.text();
    expect(body).toBe("sentinel");
    expect(res2.headers.get("etag")).toBeTruthy();
    expect(res2.headers.get("last-modified")).toBeTruthy();
    expect(
      new Date(res2.headers.get("last-modified")!).getTime(),
    ).not.toBeNaN();
  });

  it("caches video result and matches response", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/cb:${CACHE_BUSTER}/rs:fill:200:200/plain/${VIDEO_SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);
    const res = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^video\/mp4/);
    const responseBuffer = Buffer.from(await res.arrayBuffer());

    await waitForCacheWrite(urlPath);

    expect(urlPath).toMatchInlineSnapshot(
      `"/YvOqUdvwQexxIxMB5WNLwqNJ8tcFeRj29_B5500D1c4/cb:cache-test/f:mp4/rs:fill:200:200/enc/N2NhNmFkMmYzOTFhNWJlMG-aK85gpH2N6VXLBfdqOMaeRyBpwhFQE9cJlUg88UAo_oU1deehUVUo4kSOlAitLA"`,
    );

    const cachedBuffer = await fetchCachedObject(urlPath.slice(1));
    expect(cachedBuffer).toEqual(responseBuffer);
  });

  it("caches with signed plain URL as key", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/cb:${CACHE_BUSTER}/rs:fit:100:140/plain/${SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, {
      signingKey: URL_CONFIG.signingKey,
      signingSalt: URL_CONFIG.signingSalt,
    });
    const res = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const responseBuffer = Buffer.from(await res.arrayBuffer());

    await waitForCacheWrite(urlPath);

    expect(urlPath).toMatchInlineSnapshot(
      `"/sFAS-fYXkZnMlrBhSgn6uGfDLA6Wpszvp9O-u2QX7VU/cb:cache-test/f:jpg/rs:fit:100:140/plain/http://file-server/test-image.png"`,
    );

    const cachedBuffer = await fetchCachedObject(urlPath.slice(1));
    expect(cachedBuffer).toEqual(responseBuffer);
  });

  it("caches with signed encrypted URL as key", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/cb:${CACHE_BUSTER}/rs:fit:100:120/plain/${SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);
    const res = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const responseBuffer = Buffer.from(await res.arrayBuffer());

    await waitForCacheWrite(urlPath);

    expect(urlPath).toMatchInlineSnapshot(
      `"/0tVwZqCGvJBiW4PxHrJR_Tv7rbuD9kmuncj7q6ooniI/cb:cache-test/f:jpg/rs:fit:100:120/enc/NzMyYzQzZGJhYjk5ZDBlZtBKi-Id0FYxlGQ7-9wXDkM3s2zCBr3Da1CfeTUcMhYe03RhgH0EO99c6crVLSXM_A"`,
    );

    const cachedBuffer = await fetchCachedObject(urlPath.slice(1));
    expect(cachedBuffer).toEqual(responseBuffer);
  });

  it("returns 206 with correct range on cache hit", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/cb:${CACHE_BUSTER}/rs:fit:100:100/plain/${SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);

    const res1 = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res1.status).toBe(200);
    expect(res1.headers.get("content-type")).toBe("image/jpeg");
    const fullBody = Buffer.from(await res1.arrayBuffer());

    await waitForCacheWrite(urlPath);

    const res2 = await fetch(`${CACHE_PROXY_URL}${urlPath}`, {
      headers: { Range: "bytes=0-9" },
    });
    expect(res2.status).toBe(206);
    expect(res2.headers.get("content-type")).toBe("image/jpeg");
    expect(res2.headers.get("content-range")).toBe(
      `bytes 0-9/${fullBody.length}`,
    );
    expect(res2.headers.get("content-length")).toBe("10");
    expect(res2.headers.get("accept-ranges")).toBe("bytes");
    const partial = Buffer.from(await res2.arrayBuffer());
    expect(partial).toEqual(fullBody.subarray(0, 10));
  });

  it("returns 206 for suffix range on cache hit", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/cb:${CACHE_BUSTER}/rs:fit:100:100/plain/${SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);

    const res1 = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res1.status).toBe(200);
    expect(res1.headers.get("content-type")).toBe("image/jpeg");
    const fullBody = Buffer.from(await res1.arrayBuffer());

    await waitForCacheWrite(urlPath);

    const res2 = await fetch(`${CACHE_PROXY_URL}${urlPath}`, {
      headers: { Range: "bytes=-5" },
    });
    expect(res2.status).toBe(206);
    expect(res2.headers.get("content-type")).toBe("image/jpeg");
    const expectedStart = fullBody.length - 5;
    expect(res2.headers.get("content-range")).toBe(
      `bytes ${expectedStart}-${fullBody.length - 1}/${fullBody.length}`,
    );
    expect(res2.headers.get("content-length")).toBe("5");
    const partial = Buffer.from(await res2.arrayBuffer());
    expect(partial).toEqual(fullBody.subarray(expectedStart));
  });

  it("returns 416 for unsatisfiable range on cache hit", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/cb:${CACHE_BUSTER}/rs:fit:100:100/plain/${SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);

    const res1 = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res1.status).toBe(200);
    expect(res1.headers.get("content-type")).toBe("image/jpeg");
    const fullBody = Buffer.from(await res1.arrayBuffer());

    await waitForCacheWrite(urlPath);

    const res2 = await fetch(`${CACHE_PROXY_URL}${urlPath}`, {
      headers: {
        Range: `bytes=${fullBody.length + 100}-${fullBody.length + 200}`,
      },
    });
    expect(res2.status).toBe(416);
    expect(res2.headers.get("content-range")).toBe(
      `bytes */${fullBody.length}`,
    );
  });

  it("returns Accept-Ranges header on cache hit without Range request", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/cb:${CACHE_BUSTER}/rs:fit:100:100/plain/${SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);

    await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    await waitForCacheWrite(urlPath);

    const res = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-length")).toBeTruthy();
  });

  it("returns 404 for empty request URL", async () => {
    const res = await fetch(`${CACHE_PROXY_URL}/`);
    expect(await res.text()).toMatchInlineSnapshot(`""`);
    expect(res.status).toBe(404);
  });

  it("caches video info response", async () => {
    const urlPath = generateInfoUrl(
      { sourceUrl: VIDEO_SOURCE_URL },
      URL_CONFIG,
    );
    expect(urlPath).toMatchInlineSnapshot(
      `"/info/PGumTR96fYEVXnZcOEksMsWN3EGbc0cvUJTc3dayMCs/enc/N2NhNmFkMmYzOTFhNWJlMG-aK85gpH2N6VXLBfdqOMaeRyBpwhFQE9cJlUg88UAo_oU1deehUVUo4kSOlAitLA"`,
    );
    const res = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.headers.get("cache-control")).toEqual(
      "public, max-age=31536000, immutable",
    );
    const body = await res.json();
    expect(body).toMatchObject({
      duration: expect.any(Number),
      video_meta: expect.objectContaining({ codec: expect.any(String) }),
    });
    expect(body).toMatchInlineSnapshot(`
      {
        "duration": 5.069844,
        "format": "mov",
        "height": 640,
        "mime_type": "video/quicktime",
        "orientation": 1,
        "size": 747030,
        "video_meta": {
          "bitrate": 1105458,
          "codec": "h264",
          "framerate": 29.98,
        },
        "width": 360,
      }
    `);

    await waitForCacheWrite(urlPath);

    const cachedBuffer = await fetchCachedObject(urlPath.slice(1));
    expect(JSON.parse(cachedBuffer.toString())).toEqual(body);
  });

  it("does not cache error responses", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/cb:${CACHE_BUSTER}/rs:fit:100:100/plain/http://file-server/nonexistent.png`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);
    const res = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res.status).toBe(500);

    const [files] = await bucket.getFiles({ prefix: urlPath.slice(1) });
    expect(files).toHaveLength(0);
  });

  it("forwards 403 for invalid signature", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/cb:${CACHE_BUSTER}/rs:fit:100:100/plain/${SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);
    // Corrupt the signature (first path segment) so the processor rejects it
    const corruptedPath = urlPath.replace(
      /^\/[^/]+/,
      "/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
    const res = await fetch(`${CACHE_PROXY_URL}${corruptedPath}`);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Invalid signature");

    const [files] = await bucket.getFiles({ prefix: corruptedPath.slice(1) });
    expect(files).toHaveLength(0);
  });
});
