import { generateUrl } from "@socialtip/asset-proxy-url-generator";
import { parseProcessingUrl } from "@socialtip/asset-proxy-url-parser";
import { SERVICE_URL, URL_CONFIG } from "./setup.js";
import { SOURCE_URL, toPng } from "./helpers.js";
import { VIDEO_SOURCE_URL } from "./video-helpers.js";

const FAKE_GCS_URL = process.env.FAKE_GCS_URL ?? "http://localhost:4443";
const CACHE_BUCKET = "test-cache";

async function fetchCachedObject(requestPath: string): Promise<Buffer> {
  const url = `${FAKE_GCS_URL}/storage/v1/b/${CACHE_BUCKET}/o/${encodeURIComponent(requestPath)}?alt=media`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch cached object: ${res.status} ${await res.text()}`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

async function clearCache(): Promise<void> {
  const listUrl = `${FAKE_GCS_URL}/storage/v1/b/${CACHE_BUCKET}/o`;
  const res = await fetch(listUrl);
  if (!res.ok) return;
  const body = await res.json();
  for (const item of body.items ?? []) {
    await fetch(
      `${FAKE_GCS_URL}/storage/v1/b/${CACHE_BUCKET}/o/${encodeURIComponent(item.name)}`,
      { method: "DELETE" },
    );
  }
}

beforeEach(async () => {
  await clearCache();
});

describe("internal cache", () => {
  it("caches image result and matches response", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/rs:fit:100:100/plain/${SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);
    const res = await fetch(`${SERVICE_URL}${urlPath}`);
    expect(res.status).toBe(200);
    const responseBuffer = Buffer.from(await res.arrayBuffer());

    // Allow a moment for the async cache write to complete
    await new Promise((r) => setTimeout(r, 500));

    const cachedBuffer = await fetchCachedObject(urlPath);
    expect(cachedBuffer).toEqual(responseBuffer);
    expect(await toPng(cachedBuffer)).toMatchImageSnapshot();
  });

  it("caches video result and matches response", async () => {
    const parsed = parseProcessingUrl(
      `/insecure/rs:fill:200:200/plain/${VIDEO_SOURCE_URL}`,
    );
    const urlPath = generateUrl(parsed, URL_CONFIG);
    const res = await fetch(`${SERVICE_URL}${urlPath}`);
    expect(res.status).toBe(200);
    const responseBuffer = Buffer.from(await res.arrayBuffer());

    await new Promise((r) => setTimeout(r, 1000));

    const cachedBuffer = await fetchCachedObject(urlPath);
    expect(cachedBuffer).toEqual(responseBuffer);
  });
});
