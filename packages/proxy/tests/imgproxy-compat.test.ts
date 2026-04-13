import { request } from "./setup.js";

vi.mock("@google-cloud/storage", () => ({
  Storage: class {
    bucket = vi.fn(() => ({
      file: vi.fn(() => ({
        exists: vi.fn(async () => [false]),
      })),
    }));
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

vi.mock("@/h2-fetch.js", () => ({ h2Fetch: vi.fn() }));

const { createCacheProxyApp } = await import("@/cache-proxy.js");

const VSRC = "https://example.com/video.mp4";

function mockFetchHead(contentType: string) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response(null, { headers: { "content-type": contentType } }),
    );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("imgproxy compat: unsigned redirect", () => {
  it("produces an /insecure/ redirect when signing keys are not configured", async () => {
    mockFetchHead("video/mp4");
    const app = await createCacheProxyApp();
    const res = await request(app)
      .get(`/insecure/f:best/rs:fill:480:360/plain/${VSRC}`)
      .set("x-imgproxy-compat", "1");

    expect(res.status).toBe(301);
    expect(res.headers.location).toMatchInlineSnapshot(
      `"/insecure/f:webp/rs:fill:480:360/vts:0/plain/https://example.com/video.mp4"`,
    );
  });
});
