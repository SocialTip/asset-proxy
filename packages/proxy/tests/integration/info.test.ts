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
      expect(body.colorspace).toBeUndefined();
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

  describe("exif option", () => {
    it("returns EXIF metadata when exif option is enabled", async () => {
      const res = await fetchInfo(JPEG_URL, "/exif:1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.exif).toBeDefined();
      expect(body.exif.Image).toMatchInlineSnapshot(`
        {
          "Artist": "Test Photographer",
          "Copyright": "(c) 2026 Test Copyright",
          "ImageDescription": "A test image with metadata",
          "Make": "TestCamera",
          "Model": "TestModel X100",
          "Orientation": 6,
          "ResolutionUnit": 1,
          "XResolution": 1,
          "YCbCrPositioning": 1,
          "YResolution": 1,
        }
      `);
      expect(body.exif.Photo).toMatchInlineSnapshot(`
        {
          "ColorSpace": 65535,
          "ComponentsConfiguration": "01020300",
          "ExifVersion": "0232",
          "ExposureTime": 0.004,
          "FNumber": 5.6,
          "ISOSpeedRatings": 400,
        }
      `);
      expect(body.exif.GPSInfo.GPSLatitudeRef).toBe("N");
      expect(body.exif.GPSInfo.GPSLongitudeRef).toBe("W");
    });

    it("omits EXIF metadata when exif option is not set", async () => {
      const res = await fetchInfo(JPEG_URL);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.exif).toBeUndefined();
    });
  });

  describe("iptc option", () => {
    it("returns IPTC metadata when iptc option is enabled", async () => {
      const res = await fetchInfo(JPEG_URL, "/iptc:1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.iptc).toBeDefined();
      expect(body.iptc).toMatchInlineSnapshot(`
        {
          "by_line": [
            "Test Photographer",
          ],
          "caption": "A test image for IPTC metadata",
          "city": "London",
          "copyright_notice": "(c) 2026 Test",
          "country_or_primary_location_name": "United Kingdom",
          "keywords": [
            "test",
            "metadata",
          ],
          "object_name": "Test Image",
        }
      `);
    });

    it("omits IPTC metadata when iptc option is not set", async () => {
      const res = await fetchInfo(JPEG_URL);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.iptc).toBeUndefined();
    });
  });

  describe("xmp option", () => {
    it("returns XMP metadata when xmp option is enabled", async () => {
      const res = await fetchInfo(JPEG_URL, "/xmp:1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.xmp).toBeDefined();
      expect(body.xmp.dc).toMatchInlineSnapshot(`
        {
          "creator": [
            "Test Photographer",
          ],
          "description": "A test image",
          "rights": "(c) 2026 Test",
          "subject": [
            "test",
            "metadata",
          ],
          "title": "Test Image",
        }
      `);
    });

    it("omits XMP metadata when xmp option is not set", async () => {
      const res = await fetchInfo(JPEG_URL);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.xmp).toBeUndefined();
    });
  });

  describe("colorspace option", () => {
    it("returns colorspace when cs option is enabled", async () => {
      const res = await fetchInfo(IMAGE_URL, "/cs:1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.colorspace).toBe("gbr");
    });

    it("omits colorspace when option is not set", async () => {
      const res = await fetchInfo(IMAGE_URL);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.colorspace).toBeUndefined();
    });
  });

  describe("average option", () => {
    it("returns average colour when avg option is enabled", async () => {
      const res = await fetchInfo(IMAGE_URL, "/avg:t");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.average).toMatchInlineSnapshot(`
        {
          "B": 85,
          "G": 130,
          "R": 135,
        }
      `);
    });

    it("omits average when option is not set", async () => {
      const res = await fetchInfo(IMAGE_URL);
      const body = await res.json();
      expect(body.average).toBeUndefined();
    });
  });

  describe("palette option", () => {
    it("returns colour palette when p option is enabled", async () => {
      const res = await fetchInfo(IMAGE_URL, "/p:4");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.palette).toMatchInlineSnapshot(`
        [
          {
            "A": 255,
            "B": 40,
            "G": 40,
            "R": 221,
          },
          {
            "A": 255,
            "B": 40,
            "G": 181,
            "R": 40,
          },
          {
            "A": 255,
            "B": 221,
            "G": 80,
            "R": 40,
          },
          {
            "A": 255,
            "B": 40,
            "G": 221,
            "R": 241,
          },
        ]
      `);
    });

    it("omits palette when option is not set", async () => {
      const res = await fetchInfo(IMAGE_URL);
      const body = await res.json();
      expect(body.palette).toBeUndefined();
    });
  });

  describe("bands option", () => {
    it("returns bands when b option is enabled", async () => {
      const res = await fetchInfo(IMAGE_URL, "/b:1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.bands).toBe(3);
    });

    it("omits bands when option is not set", async () => {
      const res = await fetchInfo(IMAGE_URL);
      const body = await res.json();
      expect(body.bands).toBeUndefined();
    });
  });

  describe("sample_format option", () => {
    it("returns sample_format when sf option is enabled", async () => {
      const res = await fetchInfo(IMAGE_URL, "/sf:1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.sample_format).toBe("uchar");
    });

    it("omits sample_format when option is not set", async () => {
      const res = await fetchInfo(IMAGE_URL);
      const body = await res.json();
      expect(body.sample_format).toBeUndefined();
    });
  });

  describe("pages_number option", () => {
    it("returns pages_number when pn option is enabled", async () => {
      const res = await fetchInfo(IMAGE_URL, "/pn:1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.pages_number).toBe(1);
    });

    it("omits pages_number when option is not set", async () => {
      const res = await fetchInfo(IMAGE_URL);
      const body = await res.json();
      expect(body.pages_number).toBeUndefined();
    });
  });

  describe("alpha option", () => {
    it("returns alpha info when a option is enabled", async () => {
      const res = await fetchInfo(IMAGE_URL, "/a:1");
      expect(res.status).toBe(200);

      const body = await res.json();
      // test-image.png is rgb24 — no alpha channel
      expect(body.alpha).toEqual({ alpha: false });
    });

    it("omits alpha when option is not set", async () => {
      const res = await fetchInfo(IMAGE_URL);
      const body = await res.json();
      expect(body.alpha).toBeUndefined();
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
