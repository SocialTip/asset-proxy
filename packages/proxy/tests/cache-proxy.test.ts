import assert from "node:assert";
import { Readable, Writable } from "node:stream";

import { request } from "./setup.js";

const storedContent = Buffer.from("0123456789abcdef");

let cacheWriteStartedResolve: () => void;
let cacheWriteStarted: Promise<void>;
let cacheWriteFinished = false;
let finishCacheStream: () => void;

const mockCreateWriteStream = vi.fn(() => {
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
    final(callback) {
      // Don't call callback — we hold the stream open until
      // finishCacheStream() is called by the test.
      finishCacheStream = () => {
        cacheWriteFinished = true;
        callback();
      };
    },
  });
  cacheWriteStartedResolve();
  return stream;
});

const mockCreateReadStream = vi.fn(
  (opts?: { start?: number; end?: number }) => {
    const start = opts?.start ?? 0;
    const end = opts?.end ?? storedContent.length - 1;
    const slice = storedContent.subarray(start, end + 1);
    return Readable.from([slice]);
  },
);

const mockFile = vi.fn(() => ({
  exists: vi.fn(async () => [cacheWriteFinished]),
  getMetadata: vi.fn(async () => [
    {
      contentType: "video/mp4",
      size: storedContent.length,
      etag: '"abc123"',
      updated: "2025-01-01T00:00:00Z",
    },
  ]),
  createReadStream: mockCreateReadStream,
  createWriteStream: mockCreateWriteStream,
  getSignedUrl: vi.fn(async () => ["https://signed.example/video.mp4"]),
}));

vi.mock("@google-cloud/storage", () => ({
  Storage: class {
    bucket = vi.fn(() => ({ file: mockFile }));
  },
}));

vi.mock("@/env.js", () => ({
  env: {
    PORT: 8080,
    CACHE_CONTROL: "public, max-age=31536000, immutable",
    FORWARD_URL: "http://upstream:8080",
    CACHE_BUCKET: "test-cache",
  },
}));

const mockH2Fetch = vi.fn();
vi.mock("@/h2-fetch.js", () => ({ h2Fetch: mockH2Fetch }));

const { createCacheProxyApp } = await import("@/cache-proxy.js");

describe("cache proxy inflight coalescing", () => {
  beforeEach(() => {
    cacheWriteFinished = false;
    cacheWriteStarted = new Promise<void>((r) => {
      cacheWriteStartedResolve = r;
    });
    mockCreateWriteStream.mockClear();
    mockCreateReadStream.mockClear();
    mockH2Fetch.mockReset();
  });

  it("concurrent request receives the inflight stream instead of waiting for cache", async () => {
    mockH2Fetch.mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers({ "content-type": "video/mp4" }),
      body: Readable.from([Buffer.from("0123456789abcdef")]),
    });

    const app = await createCacheProxyApp();

    const firstRequest = request(app)
      .get("/some/video/path")
      .then((res) => res);

    await cacheWriteStarted;

    const secondRequest = request(app)
      .get("/some/video/path")
      .then((res) => res);

    // Let the second request handler start before completing the cache write.
    await new Promise((r) => setTimeout(r, 10));

    finishCacheStream();

    const [firstRes, secondRes] = await Promise.all([
      firstRequest,
      secondRequest,
    ]);

    expect(firstRes.status).toBe(200);
    expect(secondRes.status).toBe(200);
    expect(secondRes.headers["content-type"]).toBe("video/mp4");
    expect(Buffer.from(secondRes.body).toString()).toBe("0123456789abcdef");
    expect(mockH2Fetch).toHaveBeenCalledTimes(1);
  });

  it("source stream error after data rejects cache write for concurrent range request", async () => {
    const source = new Readable({ read() {} });
    mockH2Fetch.mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers({ "content-type": "video/mp4" }),
      body: source,
    });

    const app = await createCacheProxyApp();

    const firstRequest = request(app)
      .get("/some/video/path")
      .then((res) => res);

    // Let the route handler run (resolves h2Fetch mock, creates InflightStream,
    // registers once("data") listener). Data must be pushed after this so the
    // once("data") listener fires rather than being pre-buffered.
    await new Promise((r) => setTimeout(r, 50));

    source.push(Buffer.from("partial"));
    await cacheWriteStarted;

    const rangeRequest = request(app)
      .get("/some/video/path")
      .set("Range", "bytes=0-3")
      .then((res) => res);

    await new Promise((r) => setTimeout(r, 10));

    source.destroy(new Error("connection reset"));

    const [firstResult, rangeResult] = await Promise.allSettled([
      firstRequest,
      rangeRequest,
    ]);
    // First request's response stream was destroyed mid-transfer.
    expect(firstResult.status).toBe("rejected");
    expect(
      (firstResult as Extract<typeof firstResult, { status: "rejected" }>)
        .reason,
    ).toMatchInlineSnapshot(`[Error: response destroyed before completion]`);
    // Range request gets a 500 because the cache write was rejected.
    assert(rangeResult.status === "fulfilled");
    expect(rangeResult.value.status).toBe(500);
    expect(mockH2Fetch).toHaveBeenCalledTimes(1);
  });

  it("range request waits for inflight cache write then serves from cache", async () => {
    mockH2Fetch.mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers({ "content-type": "video/mp4" }),
      body: Readable.from([Buffer.from("0123456789abcdef")]),
    });

    const app = await createCacheProxyApp();

    const firstRequest = request(app)
      .get("/some/video/path")
      .then((res) => res);

    await cacheWriteStarted;

    const rangeRequest = request(app)
      .get("/some/video/path")
      .set("Range", "bytes=0-3")
      .then((res) => res);

    await new Promise((r) => setTimeout(r, 10));

    finishCacheStream();

    const [firstRes, rangeRes] = await Promise.all([
      firstRequest,
      rangeRequest,
    ]);

    expect(firstRes.status).toBe(200);
    expect(rangeRes.status).toBe(206);
    expect(rangeRes.headers["content-range"]).toBe(
      `bytes 0-3/${storedContent.length}`,
    );
    expect(rangeRes.headers["content-length"]).toBe("4");
  });
});

describe("cache proxy raw passthrough", () => {
  const SIZE = 16;
  let originalFetch: typeof globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFile.mockClear();
    mockCreateWriteStream.mockClear();
    mockH2Fetch.mockReset();
    originalFetch = globalThis.fetch;
    mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = {
        "content-type": "video/mp4",
        "accept-ranges": "bytes",
        etag: '"abc"',
      };
      if (init?.method === "HEAD") {
        return new Response(null, {
          headers: { ...headers, "content-length": String(SIZE) },
        });
      }
      return new Response("0123", {
        status: 206,
        headers: {
          ...headers,
          "content-length": "4",
          "content-range": `bytes 0-3/${SIZE}`,
        },
      });
    });
    globalThis.fetch = mockFetch as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("streams a range from the source without the processing proxy or cache bucket", async () => {
    const app = await createCacheProxyApp();
    const res = await request(app)
      .get("/insecure/raw:1/plain/https://example.com/video.mp4")
      .set("range", "bytes=0-3")
      .set("if-range", '"abc"');

    expect(res.status).toBe(206);
    expect(res.headers["content-range"]).toBe(`bytes 0-3/${SIZE}`);
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.headers["etag"]).toBe('"abc"');
    expect(res.text).toBe("0123");
    expect(mockFetch).toHaveBeenCalledWith("https://example.com/video.mp4", {
      headers: { range: "bytes=0-3", "if-range": '"abc"' },
    });
    expect(mockH2Fetch).not.toHaveBeenCalled();
    expect(mockFile).not.toHaveBeenCalled();
    expect(mockCreateWriteStream).not.toHaveBeenCalled();
  });

  it("signs gs:// sources and streams the range from the signed URL", async () => {
    const app = await createCacheProxyApp();
    const res = await request(app)
      .get("/insecure/raw:1/plain/gs://bucket/video.mp4")
      .set("range", "bytes=0-3");

    expect(res.status).toBe(206);
    expect(res.text).toBe("0123");
    expect(mockFetch).toHaveBeenCalledWith("https://signed.example/video.mp4", {
      headers: { range: "bytes=0-3" },
    });
    expect(mockH2Fetch).not.toHaveBeenCalled();
    expect(mockCreateWriteStream).not.toHaveBeenCalled();
  });

  it("sets Access-Control-Allow-Origin for every truthy cors value", async () => {
    const app = await createCacheProxyApp();
    for (const value of ["1", "t", "true"]) {
      const res = await request(app).get(
        `/insecure/cors:${value}/raw:1/plain/https://example.com/video.mp4`,
      );
      expect(res.headers["access-control-allow-origin"]).toBe("*");
    }
  });

  it("refuses expired URLs", async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const app = await createCacheProxyApp();
    const res = await request(app)
      .get(`/insecure/exp:${past}/raw:1/plain/https://example.com/video.mp4`)
      .set("range", "bytes=0-3");

    expect(res.status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockH2Fetch).not.toHaveBeenCalled();
  });

  it("forwards raw URLs with source checks to the processing proxy", async () => {
    mockH2Fetch.mockResolvedValue({
      status: 206,
      ok: true,
      headers: new Headers({ "content-range": `bytes 0-3/${SIZE}` }),
      body: Readable.from([Buffer.from("0123")]),
    });

    const app = await createCacheProxyApp();
    const res = await request(app)
      .get("/insecure/hs:sha256:abc/raw:1/plain/https://example.com/video.mp4")
      .set("range", "bytes=0-3");

    expect(res.status).toBe(206);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockH2Fetch).toHaveBeenCalledWith(
      "http://upstream:8080/insecure/hs:sha256:abc/raw:1/plain/https://example.com/video.mp4",
      { headers: expect.objectContaining({ range: "bytes=0-3" }) },
    );
    expect(mockFile).not.toHaveBeenCalled();
  });
});
