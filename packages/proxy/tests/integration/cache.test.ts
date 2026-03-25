import { Storage } from "@google-cloud/storage";
import { generateUrl } from "@socialtip/asset-proxy-url-generator";
import { parseProcessingUrl } from "@socialtip/asset-proxy-url-parser";
import { CACHE_PROXY_URL, URL_CONFIG, h2cFetch as fetch } from "./setup.js";
import { SOURCE_URL, toPng } from "./helpers.js";
import { VIDEO_SOURCE_URL } from "./video-helpers.js";

const FAKE_GCS_URL = process.env.FAKE_GCS_URL ?? "http://localhost:4443";
const gcs = new Storage({ apiEndpoint: FAKE_GCS_URL });
const bucket = gcs.bucket("test-cache");

async function fetchCachedObject(urlPath: string): Promise<Buffer> {
  const [contents] = await bucket.file(urlPath).download();
  return contents;
}

async function clearCache(): Promise<void> {
  const [files] = await bucket.getFiles();
  await Promise.all(files.map((f) => f.delete()));
}

beforeEach(async () => {
  await clearCache();
});

describe("cache proxy", () => {
  it("forwards to processing proxy on cache miss and caches the result", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/rs:fit:100:100/plain/${SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);
    const res = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res.status).toBe(200);
    const responseBuffer = Buffer.from(await res.arrayBuffer());

    await new Promise((r) => setTimeout(r, 500));

    expect(urlPath).toMatchInlineSnapshot(
      `"/IIda0ksDQePflaC8768xYO1JkL2PZXX3IoM9eKxi79Q/f:jpg/rs:fit:100:100/enc/NzMyYzQzZGJhYjk5ZDBlZtBKi-Id0FYxlGQ7-9wXDkM3s2zCBr3Da1CfeTUcMhYe03RhgH0EO99c6crVLSXM_A"`,
    );

    const cachedBuffer = await fetchCachedObject(urlPath.slice(1));
    expect(cachedBuffer).toEqual(responseBuffer);
    expect(await toPng(cachedBuffer)).toMatchImageSnapshot();
  });

  it("serves from cache on cache hit", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/rs:fit:100:100/plain/${SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);

    const res1 = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res1.status).toBe(200);

    await new Promise((r) => setTimeout(r, 500));

    // Overwrite the cached object with sentinel content to prove the next request reads from the bucket
    const key = urlPath.slice(1);
    const file = bucket.file(key);
    await file.save(Buffer.from("sentinel"), {
      contentType: "text/plain",
      resumable: false,
    });

    const res2 = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res2.status).toBe(200);
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
      `/insecure/rs:fill:200:200/plain/${VIDEO_SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);
    const res = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res.status).toBe(200);
    const responseBuffer = Buffer.from(await res.arrayBuffer());

    await new Promise((r) => setTimeout(r, 1000));

    expect(urlPath).toMatchInlineSnapshot(
      `"/Gz_DDAOd5yjP1O-If1JuZC6yE7axb-p-WmttOL6yjEM/f:mp4/rs:fill:200:200/enc/N2NhNmFkMmYzOTFhNWJlMG-aK85gpH2N6VXLBfdqOMaeRyBpwhFQE9cJlUg88UAo_oU1deehUVUo4kSOlAitLA"`,
    );

    const cachedBuffer = await fetchCachedObject(urlPath.slice(1));
    expect(cachedBuffer).toEqual(responseBuffer);
  });

  it("caches with signed plain URL as key", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/rs:fit:100:140/plain/${SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, {
      signingKey: URL_CONFIG.signingKey,
      signingSalt: URL_CONFIG.signingSalt,
    });
    const res = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res.status).toBe(200);
    const responseBuffer = Buffer.from(await res.arrayBuffer());

    await new Promise((r) => setTimeout(r, 500));

    expect(urlPath).toMatchInlineSnapshot(
      `"/lHGJr0YJhuqvTx_55RFqTJSGXM2mzgokm59PvP1xS68/f:jpg/rs:fit:100:140/plain/http://file-server/test-image.png"`,
    );

    const cachedBuffer = await fetchCachedObject(urlPath.slice(1));
    expect(cachedBuffer).toEqual(responseBuffer);
  });

  it("caches with signed encrypted URL as key", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/rs:fit:100:120/plain/${SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);
    const res = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res.status).toBe(200);
    const responseBuffer = Buffer.from(await res.arrayBuffer());

    await new Promise((r) => setTimeout(r, 500));

    expect(urlPath).toMatchInlineSnapshot(
      `"/eozMtxu0mSVarkeij1lPW8n5dv9k_VVOf4ssZumiVQc/f:jpg/rs:fit:100:120/enc/NzMyYzQzZGJhYjk5ZDBlZtBKi-Id0FYxlGQ7-9wXDkM3s2zCBr3Da1CfeTUcMhYe03RhgH0EO99c6crVLSXM_A"`,
    );

    const cachedBuffer = await fetchCachedObject(urlPath.slice(1));
    expect(cachedBuffer).toEqual(responseBuffer);
  });

  it("returns 206 with correct range on cache hit", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/rs:fit:100:100/plain/${SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);

    const res1 = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res1.status).toBe(200);
    const fullBody = Buffer.from(await res1.arrayBuffer());

    await new Promise((r) => setTimeout(r, 500));

    const res2 = await fetch(`${CACHE_PROXY_URL}${urlPath}`, {
      headers: { Range: "bytes=0-9" },
    });
    expect(res2.status).toBe(206);
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
      `/insecure/rs:fit:100:100/plain/${SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);

    const res1 = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res1.status).toBe(200);
    const fullBody = Buffer.from(await res1.arrayBuffer());

    await new Promise((r) => setTimeout(r, 500));

    const res2 = await fetch(`${CACHE_PROXY_URL}${urlPath}`, {
      headers: { Range: "bytes=-5" },
    });
    expect(res2.status).toBe(206);
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
      `/insecure/rs:fit:100:100/plain/${SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);

    const res1 = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res1.status).toBe(200);
    const fullBody = Buffer.from(await res1.arrayBuffer());

    await new Promise((r) => setTimeout(r, 500));

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
      `/insecure/rs:fit:100:100/plain/${SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);

    await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    await new Promise((r) => setTimeout(r, 500));

    const res = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-length")).toBeTruthy();
  });

  it("returns 404 for empty request URL", async () => {
    const res = await fetch(`${CACHE_PROXY_URL}/`);
    expect(await res.text()).toMatchInlineSnapshot(`""`);
    expect(res.status).toBe(404);
  });

  it("does not cache error responses", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/rs:fit:100:100/plain/http://file-server/nonexistent.png`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);
    const res = await fetch(`${CACHE_PROXY_URL}${urlPath}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get("content-type")).toMatchInlineSnapshot(
      `"text/plain; charset=utf-8"`,
    );
    expect(await res.text()).toMatchInlineSnapshot(`"Unhandled error"`);

    const [files] = await bucket.getFiles({ prefix: urlPath.slice(1) });
    expect(files).toHaveLength(0);
  });
});
