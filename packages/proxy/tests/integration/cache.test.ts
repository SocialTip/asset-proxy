import { Storage } from "@google-cloud/storage";
import { generateUrl } from "@socialtip/asset-proxy-url-generator";
import { parseProcessingUrl } from "@socialtip/asset-proxy-url-parser";
import { SERVICE_URL, URL_CONFIG } from "./setup.js";
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

    expect(urlPath).toMatchInlineSnapshot(
      `"/IIda0ksDQePflaC8768xYO1JkL2PZXX3IoM9eKxi79Q/f:jpg/rs:fit:100:100/enc/NzMyYzQzZGJhYjk5ZDBlZtBKi-Id0FYxlGQ7-9wXDkM3s2zCBr3Da1CfeTUcMhYe03RhgH0EO99c6crVLSXM_A"`,
    );

    const cachedBuffer = await fetchCachedObject(urlPath.slice(1));
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

    expect(urlPath).toMatchInlineSnapshot(
      `"/Gz_DDAOd5yjP1O-If1JuZC6yE7axb-p-WmttOL6yjEM/f:mp4/rs:fill:200:200/enc/N2NhNmFkMmYzOTFhNWJlMG-aK85gpH2N6VXLBfdqOMaeRyBpwhFQE9cJlUg88UAo_oU1deehUVUo4kSOlAitLA"`,
    );

    const cachedBuffer = await fetchCachedObject(urlPath.slice(1));
    expect(cachedBuffer).toEqual(responseBuffer);
  });
});
