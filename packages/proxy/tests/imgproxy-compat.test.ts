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
const ISRC = "https://example.com/photo.jpg";

describe("imgproxy compat: video format best", () => {
  it("redirects video + f:best to webp thumbnail when compat header is set", async () => {
    const app = await createCacheProxyApp();
    const res = await request(app)
      .get(`/insecure/f:best/rs:fill:480:360/plain/${VSRC}`)
      .set("x-imgproxy-compat", "1");

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(
      `/insecure/rs:fill:480:360/f:webp/vts:0/plain/${VSRC}`,
    );
  });

  it("redirects video + @best suffix to webp thumbnail when compat header is set", async () => {
    const app = await createCacheProxyApp();
    const res = await request(app)
      .get(`/insecure/rs:fill:480:360/plain/${VSRC}@best`)
      .set("x-imgproxy-compat", "1");

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(
      `/insecure/rs:fill:480:360/f:webp/vts:0/plain/${VSRC}`,
    );
  });

  it("does not redirect when compat header is absent", async () => {
    const app = await createCacheProxyApp();
    const res = await request(app).get(
      `/insecure/f:best/rs:fill:480:360/plain/${VSRC}`,
    );

    expect(res.status).not.toBe(301);
  });

  it("does not redirect image sources with f:best", async () => {
    const app = await createCacheProxyApp();
    const res = await request(app)
      .get(`/insecure/f:best/w:100/plain/${ISRC}`)
      .set("x-imgproxy-compat", "1");

    expect(res.status).not.toBe(301);
  });

  it("does not redirect video without best format", async () => {
    const app = await createCacheProxyApp();
    const res = await request(app)
      .get(`/insecure/f:webp/vts:0/plain/${VSRC}`)
      .set("x-imgproxy-compat", "1");

    expect(res.status).not.toBe(301);
  });

  it("does not redirect when video_thumbnail_second is already set", async () => {
    const app = await createCacheProxyApp();
    const res = await request(app)
      .get(`/insecure/f:best/vts:5/plain/${VSRC}`)
      .set("x-imgproxy-compat", "1");

    expect(res.status).not.toBe(301);
  });

  it("redirects video with no extension + f:best", async () => {
    const app = await createCacheProxyApp();
    const src = "https://example.com/media/12345";
    const res = await request(app)
      .get(`/insecure/f:best/plain/${src}`)
      .set("x-imgproxy-compat", "1");

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(`/insecure/f:webp/vts:0/plain/${src}`);
  });

  it("preserves all other options in the redirect URL", async () => {
    const app = await createCacheProxyApp();
    const res = await request(app)
      .get(`/insecure/f:best/rs:fill:480:360/q:80/bl:5/plain/${VSRC}`)
      .set("x-imgproxy-compat", "1");

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(
      `/insecure/rs:fill:480:360/q:80/bl:5/f:webp/vts:0/plain/${VSRC}`,
    );
  });

  it("re-signs the redirect URL when signing keys are configured", async () => {
    const { env } = await import("@/env.js");
    const signingKey = Buffer.from("736563726574", "hex");
    const signingSalt = Buffer.from("68656c6c6f", "hex");
    Object.assign(env, {
      SIGNING_KEY: signingKey,
      SIGNING_SALT: signingSalt,
    });

    try {
      const app = await createCacheProxyApp();

      const { sign } = await import("@socialtip/asset-proxy-url-parser");
      const expectedPath = `/rs:fill:480:360/f:webp/vts:0/plain/${VSRC}`;
      const expectedSignature = sign(expectedPath, signingKey, signingSalt);

      const res = await request(app)
        .get(`/insecure/f:best/rs:fill:480:360/plain/${VSRC}`)
        .set("x-imgproxy-compat", "1");

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe(`/${expectedSignature}${expectedPath}`);
    } finally {
      Object.assign(env, {
        SIGNING_KEY: undefined,
        SIGNING_SALT: undefined,
      });
    }
  });
});
