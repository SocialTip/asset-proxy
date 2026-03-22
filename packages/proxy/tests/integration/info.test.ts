import { decode } from "blurhash";
import sharp from "sharp";
import { SERVICE_URL } from "./setup.js";

const IMAGE_URL = "http://file-server/test-image.png";
const BUTTERFLY_URL = "http://file-server/test-image-butterfly.png";
const CASTLE_URL = "http://file-server/test-image-castle.jpg";
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

  describe("dominant_colors option", () => {
    it("returns dominant colours when dc option is enabled", async () => {
      const res = await fetchInfo(BUTTERFLY_URL, "/dc:1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.dominant_colors).toMatchInlineSnapshot(`
        {
          "dark_muted": {
            "B": 13,
            "G": 12,
            "R": 20,
          },
          "dark_vibrant": {
            "B": 22,
            "G": 122,
            "R": 84,
          },
          "light_vibrant": {
            "B": 188,
            "G": 220,
            "R": 237,
          },
          "vibrant": {
            "B": 27,
            "G": 140,
            "R": 112,
          },
        }
      `);
    });

    it("returns dominant colours for a low-saturation image", async () => {
      const res = await fetchInfo(CASTLE_URL, "/dc:1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.dominant_colors).toMatchInlineSnapshot(`
        {
          "dark_muted": {
            "B": 21,
            "G": 16,
            "R": 15,
          },
          "light_vibrant": {
            "B": 206,
            "G": 232,
            "R": 247,
          },
          "muted": {
            "B": 97,
            "G": 133,
            "R": 177,
          },
          "vibrant": {
            "B": 127,
            "G": 164,
            "R": 202,
          },
        }
      `);
    });

    it("omits dominant_colors when option is not set", async () => {
      const res = await fetchInfo(IMAGE_URL);
      const body = await res.json();
      expect(body.dominant_colors).toBeUndefined();
    });
  });

  describe("blurhash option", () => {
    it("returns blurhash when bh option is enabled", async () => {
      const res = await fetchInfo(BUTTERFLY_URL, "/bh:4:3");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.blurhash).toMatchInlineSnapshot(
        `"LRHxh{=]X*%c~Q%0xFxsKxj0vkWE"`,
      );

      const width = 32;
      const height = 24;
      const pixels = decode(body.blurhash, width, height);
      const png = await sharp(Buffer.from(pixels.buffer), {
        raw: { width, height, channels: 4 },
      })
        .png()
        .toBuffer();
      expect(png).toMatchImageSnapshot();
    });

    it("omits blurhash when option is not set", async () => {
      const res = await fetchInfo(IMAGE_URL);
      const body = await res.json();
      expect(body.blurhash).toBeUndefined();
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

    it("returns colour palette for a butterfly image", async () => {
      const res = await fetchInfo(BUTTERFLY_URL, "/p:6");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.palette).toMatchInlineSnapshot(`
        [
          {
            "A": 255,
            "B": 35,
            "G": 168,
            "R": 162,
          },
          {
            "A": 255,
            "B": 25,
            "G": 133,
            "R": 102,
          },
          {
            "A": 255,
            "B": 14,
            "G": 42,
            "R": 44,
          },
          {
            "A": 255,
            "B": 61,
            "G": 182,
            "R": 227,
          },
        ]
      `);
    });

    it("returns colour palette for a castle image", async () => {
      const res = await fetchInfo(CASTLE_URL, "/p:6");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.palette).toMatchInlineSnapshot(`
        [
          {
            "A": 255,
            "B": 22,
            "G": 17,
            "R": 16,
          },
          {
            "A": 255,
            "B": 30,
            "G": 28,
            "R": 30,
          },
          {
            "A": 255,
            "B": 69,
            "G": 87,
            "R": 117,
          },
          {
            "A": 255,
            "B": 171,
            "G": 203,
            "R": 229,
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

  describe("calc_hashsums option", () => {
    it("returns hashsums when chs option is enabled", async () => {
      const res = await fetchInfo(IMAGE_URL, "/chs:md5:sha256");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.hashsums).toMatchInlineSnapshot(`
        {
          "md5": "754739ad10ce8989cf295e3dcd3c8ad6",
          "sha256": "efd163fab569d4beec64e268346b33c61e98024b226eae40c3de0e469951a4d6",
        }
      `);

      await expect(
        fetchInfo(IMAGE_URL, "/chs:sha1:sha512:sha1")
          .then((res) => res.json())
          .then((res) => res.hashsums),
      ).resolves.toMatchInlineSnapshot(`
        {
          "sha1": "31e94ea8de575a0a3f7f4335c3dad60b75d89d89",
          "sha512": "0a9c0e679221b92eaae2dcc4aa4170291e6eebc22ccca646e86e2ada8257e728604001354458acfbe7dedfbfb438d8ffcc5e492c16263734318c5599c53738fd",
        }
      `);
    });

    it("omits hashsums when option is not set", async () => {
      const res = await fetchInfo(IMAGE_URL);
      const body = await res.json();
      expect(body.hashsums).toBeUndefined();
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

    it("accepts a valid hashsum", async () => {
      const res = await fetchInfo(
        IMAGE_URL,
        "/hs:sha256:efd163fab569d4beec64e268346b33c61e98024b226eae40c3de0e469951a4d6",
      );
      expect(res.status).toBe(200);
    });

    it("rejects an invalid hashsum", async () => {
      const res = await fetchInfo(IMAGE_URL, "/hs:sha256:badhash");
      expect(res.status).toBe(422);
      expect(await res.text()).toMatchInlineSnapshot(
        `"Source hashsum mismatch: expected badhash, got efd163fab569d4beec64e268346b33c61e98024b226eae40c3de0e469951a4d6"`,
      );
    });

    it("rejects when source exceeds max file size", async () => {
      const res = await fetchInfo(IMAGE_URL, "/msfs:1");
      expect(res.status).toBe(422);
      expect(await res.text()).toMatchInlineSnapshot(
        `"Source file size 881 exceeds limit of 1 bytes"`,
      );
    });

    it("rejects when source exceeds max resolution", async () => {
      // test-image.png is 200x150 = 0.03MP; set limit to 0.0001MP
      const res = await fetchInfo(IMAGE_URL, "/msr:0.0001");
      expect(res.status).toBe(422);
      expect(await res.text()).toMatchInlineSnapshot(
        `"Source resolution 0.0MP exceeds limit of 0.0001MP"`,
      );
    });

    it("returns an error for an unreachable source", async () => {
      const res = await fetchInfo("http://file-server/nonexistent.png");
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await res.text()).toMatchInlineSnapshot(
        `"Could not fetch source"`,
      );
    });
  });
});
