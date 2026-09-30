import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateUrl } from "@socialtip/asset-proxy-url-generator";
import { parseProcessingUrl } from "@socialtip/asset-proxy-url-parser";

import { SOURCE_URL } from "./helpers.js";
import {
  CACHE_PROXY_URL,
  h2Fetch as fetch,
  SERVICE_URL,
  URL_CONFIG,
} from "./setup.js";

const fixturesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures",
);

describe("raw passthrough", () => {
  it("returns the original image unmodified when raw:1 is set", async () => {
    const parsed = parseProcessingUrl(`/insecure/raw:1/plain/${SOURCE_URL}`);
    const res = await fetch(`${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");

    const proxyBuffer = Buffer.from(await res.arrayBuffer());
    const sourceBuffer = readFileSync(resolve(fixturesDir, "test-image.png"));
    expect(proxyBuffer.equals(sourceBuffer)).toBe(true);
  });
});

describe.each([
  ["processing proxy", SERVICE_URL],
  ["cache proxy", CACHE_PROXY_URL],
])("raw byte ranges via %s", (_name, baseUrl) => {
  const source = readFileSync(resolve(fixturesDir, "test-image.png"));
  const url = `${baseUrl}${generateUrl(
    parseProcessingUrl(`/insecure/raw:1/plain/${SOURCE_URL}`),
    URL_CONFIG,
  )}`;

  it("advertises range support on a full response", async () => {
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-length")).toBe(String(source.length));
    expect(res.headers.get("etag")).toBeTruthy();
    expect(res.headers.get("last-modified")).toBeTruthy();
  });

  it("returns 206 for a range at the start of the file", async () => {
    const res = await fetch(url, { headers: { range: "bytes=0-99" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(
      `bytes 0-99/${source.length}`,
    );
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(source.subarray(0, 100))).toBe(true);
  });

  it("returns 206 for a range at the end of the file", async () => {
    const res = await fetch(url, { headers: { range: "bytes=-100" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(
      `bytes ${source.length - 100}-${source.length - 1}/${source.length}`,
    );
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(source.subarray(-100))).toBe(true);
  });

  it("returns 416 for an unsatisfiable range", async () => {
    const res = await fetch(url, {
      headers: { range: `bytes=${source.length}-` },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${source.length}`);
  });
});

describe("raw passthrough headers", () => {
  const path = generateUrl(
    parseProcessingUrl(
      `/insecure/exp:${Math.floor(Date.now() / 1000) + 3600}/raw:1/plain/${SOURCE_URL}`,
    ),
    URL_CONFIG,
  );
  const names = [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
    "cache-control",
    "content-disposition",
  ];

  it.each([
    ["a full response", {}],
    ["a range response", { range: "bytes=0-99" }],
  ])(
    "match between the cache and processing proxies for %s",
    async (_name, headers) => {
      const [processing, cache] = await Promise.all(
        [SERVICE_URL, CACHE_PROXY_URL].map((base) =>
          fetch(`${base}${path}`, { headers }),
        ),
      );
      expect(cache.status).toBe(processing.status);
      const pick = (res: Response) =>
        names.map((n) =>
          n === "cache-control"
            ? res.headers.get(n)?.replace(/max-age=\d+/, "max-age=N")
            : res.headers.get(n),
        );
      expect(pick(cache)).toEqual(pick(processing));
    },
  );
});
