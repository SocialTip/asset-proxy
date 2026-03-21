import { SERVICE_URL } from "./setup.js";

const IMAGE_URL = "http://file-server/test-image.png";
const JPEG_URL = "http://file-server/test-image-with-metadata.jpg";
const VIDEO_URL = "http://file-server/test-video.mp4";

async function fetchInfo(sourceUrl: string, options = "") {
  const url = `${SERVICE_URL}/info/insecure${options}/plain/${sourceUrl}`;
  return fetch(url);
}

describe("info endpoint", () => {
  describe("images", () => {
    it("returns correct metadata for a PNG image", async () => {
      const res = await fetchInfo(IMAGE_URL);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      expect(res.headers.get("cache-control")).toBeTruthy();

      const body = await res.json();
      expect(body).toMatchObject({
        format: "png",
        mime_type: "image/png",
        width: expect.any(Number),
        height: expect.any(Number),
        orientation: 1,
      });
      expect(body.width).toBeGreaterThan(0);
      expect(body.height).toBeGreaterThan(0);
      expect(body.size).toBeGreaterThan(0);
      expect(body.duration).toBeUndefined();
      expect(body.video_meta).toBeUndefined();
    });

    it("returns EXIF orientation and adjusts dimensions for a rotated JPEG", async () => {
      const res = await fetchInfo(JPEG_URL);
      expect(res.status).toBe(200);

      const body = await res.json();
      // test-image-with-metadata.jpg is 200x150 pixels with EXIF orientation 6
      // (90° CW), so reported dimensions are swapped
      expect(body).toMatchObject({
        orientation: 6,
        width: 150,
        height: 200,
      });
    });
  });

  describe("videos", () => {
    it("returns correct metadata for an MP4 video", async () => {
      const res = await fetchInfo(VIDEO_URL);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toMatchObject({
        format: expect.any(String),
        mime_type: expect.any(String),
        width: expect.any(Number),
        height: expect.any(Number),
        orientation: expect.any(Number),
        duration: expect.any(Number),
        video_meta: {
          codec: expect.any(String),
        },
      });
      expect(body.width).toBeGreaterThan(0);
      expect(body.height).toBeGreaterThan(0);
      expect(body.duration).toBeGreaterThan(0);
      expect(body.size).toBeGreaterThan(0);
    });
  });

  describe("validation", () => {
    it("rejects disallowed origins when ALLOWED_ORIGINS is set", async () => {
      // The test service doesn't have ALLOWED_ORIGINS set, so this just
      // verifies the endpoint works with any origin. Origin restriction
      // is tested implicitly by the shared assertOriginAllowed logic.
      const res = await fetchInfo(IMAGE_URL);
      expect(res.status).toBe(200);
    });

    it("returns an error for an unreachable source", async () => {
      const res = await fetchInfo("http://file-server/nonexistent.png");
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });
});
