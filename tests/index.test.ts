import request from "supertest";

vi.hoisted(() => {
  process.env.SKIP_GPU = "1";
  process.env.ALLOWED_ORIGINS = "http://file-server,https://example.com";
});

vi.mock("../src/ffmpeg.js");
vi.mock("../src/sharp.js");
vi.mock("@google-cloud/storage", () => ({ Storage: vi.fn() }));

const { app } = await import("../src/index.js");

describe("origin allowlist", () => {
  it("allows a request with a permitted origin", async () => {
    const res = await request(app)
      .get("/insecure/resize:fill:128:128/plain/https://example.com/video.mp4")
      .buffer(true);

    expect(res.status).toBe(200);
  });

  it("rejects a request with a non-permitted origin", async () => {
    const res = await request(app).get(
      "/insecure/resize:fill:128:128/plain/https://evil.com/video.mp4",
    );

    expect(res.status).toBe(403);
    expect(res.text).toContain("Origin not allowed");
  });
});
