import { Readable, Writable } from "node:stream";
import request from "supertest";

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
    { contentType: "video/mp4", size: storedContent.length },
  ]),
  createReadStream: mockCreateReadStream,
  createWriteStream: mockCreateWriteStream,
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

vi.mock("@/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { createCacheProxyApp } = await import("@/cache-proxy.js");

describe("cache proxy inflight coalescing", () => {
  beforeEach(() => {
    cacheWriteFinished = false;
    cacheWriteStarted = new Promise<void>((r) => {
      cacheWriteStartedResolve = r;
    });
    mockCreateWriteStream.mockClear();
    mockCreateReadStream.mockClear();
  });

  it("range request waits for inflight cache write then serves from cache", async () => {
    const upstreamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("0123456789abcdef"));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(upstreamBody, {
          status: 200,
          headers: { "content-type": "video/mp4" },
        }),
      ),
    );

    const app = createCacheProxyApp();

    const firstRequest = request(app)
      .get("/some/video/path")
      .then((res) => res);

    await cacheWriteStarted;

    const rangeRequest = request(app)
      .get("/some/video/path")
      .set("Range", "bytes=0-3")
      .then((res) => res);

    // Let the range request handler start before completing the cache write.
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

    vi.unstubAllGlobals();
  });
});
