import { generateInfoUrl } from "@socialtip/asset-proxy-url-generator";
import { decode } from "blurhash";
import sharp from "sharp";

import { h2Fetch as fetch, SERVICE_URL, URL_CONFIG } from "./setup.js";

const IMAGE_URL = "http://file-server/test-image.png";
const BUTTERFLY_URL = "http://file-server/test-image-butterfly.png";
const CASTLE_URL = "http://file-server/test-image-castle.jpg";
const ANIMATED_URL = "http://file-server/test-image-animated.gif";
const JPEG_URL = "http://file-server/test-image-with-metadata.jpg";
const VIDEO_URL = "http://file-server/test-video.mp4";
const VIDEO_NOAUDIO_URL = "http://file-server/test-video-noaudio.mp4";

describe("info endpoint", () => {
  describe("images", () => {
    it("returns correct metadata for a PNG image", async () => {
      const res = await fetch(
        SERVICE_URL + generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG),
      );
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

    it("returns correct metadata for a JPEG image", async () => {
      const res = await fetch(
        SERVICE_URL + generateInfoUrl({ sourceUrl: CASTLE_URL }, URL_CONFIG),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toMatchObject({
        format: "jpeg",
        mime_type: "image/jpeg",
        width: expect.any(Number),
        height: expect.any(Number),
        orientation: expect.any(Number),
      });
      expect(body.size).toBeGreaterThan(0);
      expect(body.duration).toBeUndefined();
      expect(body.video_meta).toBeUndefined();
    });

    it("returns EXIF orientation and adjusts dimensions for a rotated JPEG", async () => {
      const res = await fetch(
        SERVICE_URL + generateInfoUrl({ sourceUrl: JPEG_URL }, URL_CONFIG),
      );
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
      const res = await fetch(
        SERVICE_URL + generateInfoUrl({ sourceUrl: VIDEO_URL }, URL_CONFIG),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toMatchInlineSnapshot(`
        {
          "duration": 5.069844,
          "exif": {},
          "format": "mov,mp4,m4a,3gp,3g2,mj2",
          "height": 640,
          "iptc": {},
          "mime_type": "video/mp4",
          "orientation": 1,
          "size": 747030,
          "video_meta": {
            "bitrate": 1105458,
            "codec": "h264",
            "compatible_brands": "isomiso2avc1mp41",
            "encoder": "Lavf61.7.100",
            "framerate": 29.98,
            "major_brand": "isom",
            "minor_version": "512",
          },
          "video_streams": [
            {
              "bps": 1105458,
              "codec": "h264",
              "duration": 5.069844,
              "fps": 29.98,
              "language": "und",
              "type": "video",
            },
            {
              "bps": 63410,
              "codec": "aac",
              "duration": 5.04,
              "frequency": 44100,
              "language": "und",
              "layout": "stereo",
              "type": "audio",
            },
          ],
          "width": 360,
          "xmp": {},
        }
      `);
    });
  });

  describe("exif option", () => {
    it("returns EXIF metadata when exif option is enabled", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: JPEG_URL }, URL_CONFIG, { exif: true }),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.exif).toMatchInlineSnapshot(`
        {
          "GPSInfo": {
            "GPSLatitude": 51.5074,
            "GPSLatitudeRef": "N",
            "GPSLongitude": 0.1278,
            "GPSLongitudeRef": "W",
            "GPSVersionID": "2 3 0 0",
          },
          "Image": {
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
          },
          "Photo": {
            "ColorSpace": 65535,
            "ComponentsConfiguration": "1 2 3 0",
            "ExifVersion": "0232",
            "ExposureTime": 0.004,
            "FNumber": 5.6,
            "ISO": 400,
          },
        }
      `);
    });

    it("omits EXIF metadata when exif is disabled", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: JPEG_URL }, URL_CONFIG, {
            exif: false,
          }),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.exif).toBeUndefined();
    });
  });

  describe("iptc option", () => {
    it("returns IPTC metadata when iptc option is enabled", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: JPEG_URL }, URL_CONFIG, { iptc: true }),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.iptc).toMatchInlineSnapshot(`
        {
          "Application Record Version": 4,
          "By-line": "Test Photographer",
          "Caption-Abstract": "A test image for IPTC metadata",
          "City": "London",
          "Copyright Notice": "(c) 2026 Test",
          "Country-Primary Location Name": "United Kingdom",
          "Keywords": [
            "test",
            "metadata",
          ],
          "Object Name": "Test Image",
        }
      `);
    });

    it("omits IPTC metadata when iptc is disabled", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: JPEG_URL }, URL_CONFIG, {
            iptc: false,
          }),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.iptc).toBeUndefined();
    });
  });

  describe("xmp option", () => {
    it("returns XMP metadata when xmp option is enabled", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: JPEG_URL }, URL_CONFIG, { xmp: true }),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.xmp).toMatchInlineSnapshot(`
        {
          "dc": {
            "Creator": "Test Photographer",
            "Description": "A test image",
            "Rights": "(c) 2026 Test",
            "Subject": [
              "test",
              "metadata",
            ],
            "Title": "Test Image",
          },
          "x": {
            "XMPToolkit": "Image::ExifTool 13.50",
          },
        }
      `);
    });

    it("omits XMP metadata when xmp is disabled", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: JPEG_URL }, URL_CONFIG, {
            xmp: false,
          }),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.xmp).toBeUndefined();
    });
  });

  describe("colorspace option", () => {
    it("returns colorspace when cs option is enabled", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG, {
            colorspace: true,
          }),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.colorspace).toBe("gbr");
    });

    it("omits colorspace when option is not set", async () => {
      const res = await fetch(
        SERVICE_URL + generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.colorspace).toBeUndefined();
    });
  });

  describe("average option", () => {
    it("returns average colour when avg option is enabled", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG, {
            average: { ignoreTransparent: false },
          }),
      );
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
      const res = await fetch(
        SERVICE_URL + generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG),
      );
      const body = await res.json();
      expect(body.average).toBeUndefined();
    });
  });

  describe("dominant_colors option", () => {
    it("returns dominant colours when dc option is enabled", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: BUTTERFLY_URL }, URL_CONFIG, {
            dominantColors: true,
          }),
      );
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
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: CASTLE_URL }, URL_CONFIG, {
            dominantColors: true,
          }),
      );
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
      const res = await fetch(
        SERVICE_URL + generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG),
      );
      const body = await res.json();
      expect(body.dominant_colors).toBeUndefined();
    });
  });

  describe("blurhash option", () => {
    it("returns blurhash when bh option is enabled", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: BUTTERFLY_URL }, URL_CONFIG, {
            blurhash: { xComponents: 4, yComponents: 3 },
          }),
      );
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
      const res = await fetch(
        SERVICE_URL + generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG),
      );
      const body = await res.json();
      expect(body.blurhash).toBeUndefined();
    });
  });

  describe("palette option", () => {
    it("returns colour palette when p option is enabled", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG, { palette: 4 }),
      );
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
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: BUTTERFLY_URL }, URL_CONFIG, {
            palette: 6,
          }),
      );
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
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: CASTLE_URL }, URL_CONFIG, {
            palette: 6,
          }),
      );
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
      const res = await fetch(
        SERVICE_URL + generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG),
      );
      const body = await res.json();
      expect(body.palette).toBeUndefined();
    });
  });

  describe("calc_hashsums option", () => {
    it("returns hashsums when chs option is enabled", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG, {
            calcHashsums: ["md5", "sha256"],
          }),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.hashsums).toMatchInlineSnapshot(`
        {
          "md5": "754739ad10ce8989cf295e3dcd3c8ad6",
          "sha256": "efd163fab569d4beec64e268346b33c61e98024b226eae40c3de0e469951a4d6",
        }
      `);

      const res2 = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG, {
            calcHashsums: ["sha1", "sha512"],
          }),
      );
      const body2 = await res2.json();
      expect(body2.hashsums).toMatchInlineSnapshot(`
        {
          "sha1": "31e94ea8de575a0a3f7f4335c3dad60b75d89d89",
          "sha512": "0a9c0e679221b92eaae2dcc4aa4170291e6eebc22ccca646e86e2ada8257e728604001354458acfbe7dedfbfb438d8ffcc5e492c16263734318c5599c53738fd",
        }
      `);
    });

    it("omits hashsums when option is not set", async () => {
      const res = await fetch(
        SERVICE_URL + generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG),
      );
      const body = await res.json();
      expect(body.hashsums).toBeUndefined();
    });
  });

  describe("bands option", () => {
    it("returns bands when b option is enabled", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG, {
            bands: true,
          }),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.bands).toBe(3);
    });

    it("omits bands when option is not set", async () => {
      const res = await fetch(
        SERVICE_URL + generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG),
      );
      const body = await res.json();
      expect(body.bands).toBeUndefined();
    });
  });

  describe("sample_format option", () => {
    it("returns sample_format when sf option is enabled", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG, {
            sampleFormat: true,
          }),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.sample_format).toBe("uchar");
    });

    it("omits sample_format when option is not set", async () => {
      const res = await fetch(
        SERVICE_URL + generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG),
      );
      const body = await res.json();
      expect(body.sample_format).toBeUndefined();
    });
  });

  describe("pages_number option", () => {
    it("returns pages_number when pn option is enabled", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG, {
            pagesNumber: true,
          }),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.pages_number).toBe(1);
    });

    it("omits pages_number when option is not set", async () => {
      const res = await fetch(
        SERVICE_URL + generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG),
      );
      const body = await res.json();
      expect(body.pages_number).toBeUndefined();
    });
  });

  describe("alpha option", () => {
    it("returns alpha info when a option is enabled", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG, {
            alpha: true,
          }),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      // test-image.png is rgb24 — no alpha channel
      expect(body.alpha).toEqual({ alpha: false });
    });

    it("omits alpha when option is not set", async () => {
      const res = await fetch(
        SERVICE_URL + generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG),
      );
      const body = await res.json();
      expect(body.alpha).toBeUndefined();
    });
  });

  describe("page option", () => {
    it("returns average colour for frame 0 (red)", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: ANIMATED_URL }, URL_CONFIG, {
            page: 0,
            average: { ignoreTransparent: false },
          }),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.average).toMatchInlineSnapshot(`
        {
          "B": 0,
          "G": 0,
          "R": 255,
        }
      `);
    });

    it("returns average colour for frame 1 (blue)", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: ANIMATED_URL }, URL_CONFIG, {
            page: 1,
            average: { ignoreTransparent: false },
          }),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.average).toMatchInlineSnapshot(`
        {
          "B": 255,
          "G": 0,
          "R": 0,
        }
      `);
    });
  });

  describe("video metadata options", () => {
    it("returns empty exif/iptc/xmp for a video when options are enabled", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: VIDEO_URL }, URL_CONFIG, {
            exif: true,
            iptc: true,
            xmp: true,
          }),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.exif).toEqual({});
      expect(body.iptc).toEqual({});
      expect(body.xmp).toEqual({});
    });

    it("returns only video stream for a no-audio video", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: VIDEO_NOAUDIO_URL }, URL_CONFIG),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.video_streams).toHaveLength(1);
      expect(body.video_streams[0]).toMatchObject({
        type: "video",
        codec: "h264",
      });
      expect(
        body.video_streams.some(
          (s: Record<string, unknown>) => s.type === "audio",
        ),
      ).toBe(false);
    });
  });

  describe("default-true options", () => {
    it("omits size when size:f is set", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG, {
            size: false,
          }),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.size).toBeUndefined();
      expect(body.format).toBeDefined();
      expect(body.width).toBeDefined();
    });

    it("omits format and mime_type when format:f is set", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG, {
            format: false,
          }),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.format).toBeUndefined();
      expect(body.mime_type).toBeUndefined();
      expect(body.width).toBeDefined();
      expect(body.size).toBeDefined();
    });

    it("omits dimensions when dimensions:f is set", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: IMAGE_URL }, URL_CONFIG, {
            dimensions: false,
          }),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.width).toBeUndefined();
      expect(body.height).toBeUndefined();
      expect(body.orientation).toBeUndefined();
      expect(body.format).toBeDefined();
      expect(body.size).toBeDefined();
    });

    it("omits video_meta and video_streams when video_meta:f is set", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl({ sourceUrl: VIDEO_URL }, URL_CONFIG, {
            videoMeta: false,
          }),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.video_meta).toBeUndefined();
      expect(body.video_streams).toBeUndefined();
      expect(body.duration).toBeUndefined();
      expect(body.format).toBeDefined();
      expect(body.size).toBeDefined();
    });
  });

  describe("validation", () => {
    it("rejects disallowed origins", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl(
            { sourceUrl: "http://evil.example.com/photo.jpg" },
            URL_CONFIG,
          ),
      );
      expect(res.status).toBe(403);
      expect(await res.text()).toMatchInlineSnapshot(
        `"Origin not allowed: http://evil.example.com"`,
      );
    });

    it("returns an error for an unreachable source", async () => {
      const res = await fetch(
        SERVICE_URL +
          generateInfoUrl(
            { sourceUrl: "http://file-server/nonexistent.png" },
            URL_CONFIG,
          ),
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await res.text()).toMatchInlineSnapshot(`"Unhandled error"`);
    });
  });
});
