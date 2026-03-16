import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const TEST_KEY_HEX =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TEST_KEY = Buffer.from(TEST_KEY_HEX, "hex");

function encrypt(url: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", TEST_KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(url, "utf-8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, encrypted]).toString("base64url");
}

vi.stubEnv("SOURCE_URL_ENCRYPTION_KEY", TEST_KEY_HEX);
const { parseProcessingUrl, isImageUrl, isVideoUrl } =
  await import("../src/url-parser.js");

describe("parseProcessingUrl", () => {
  it("parses a plain source URL", () => {
    const result = parseProcessingUrl(
      "/resize:fill:480:360/plain/https://example.com/video.mp4",
    );

    expect(result.sourceUrl).toBe("https://example.com/video.mp4");
    expect(result.resize).toEqual({ type: "fill", width: 480, height: 360 });
    expect(result.outputFormat).toBe("mp4");
  });

  it("parses an encrypted source URL", () => {
    const original = "https://example.com/video.mp4";
    const encrypted = encrypt(original);

    const result = parseProcessingUrl(`/resize:fill:480:360/enc/${encrypted}`);

    expect(result.sourceUrl).toBe(original);
    expect(result.resize).toEqual({ type: "fill", width: 480, height: 360 });
  });

  it("parses framerate option", () => {
    const result = parseProcessingUrl(
      "/resize:fill:480:360/framerate:30/plain/https://example.com/video.mp4",
    );
    expect(result.framerate).toBe(30);
  });

  it("parses framerate shorthand (fr)", () => {
    const result = parseProcessingUrl(
      "/resize:fill:480:360/fr:24/plain/https://example.com/video.mp4",
    );
    expect(result.framerate).toBe(24);
  });

  it("parses trim option", () => {
    const result = parseProcessingUrl(
      "/resize:fill:480:360/trim:10/plain/https://example.com/video.mp4",
    );
    expect(result.trim).toBe(10);
  });

  it("parses trim shorthand (tr)", () => {
    const result = parseProcessingUrl(
      "/resize:fill:480:360/tr:5.5/plain/https://example.com/video.mp4",
    );
    expect(result.trim).toBe(5.5);
  });

  it("parses all video options together", () => {
    const result = parseProcessingUrl(
      "/rs:fill:480:360/fr:30/tr:10/plain/https://example.com/video.mp4@webm",
    );
    expect(result.resize).toEqual({ type: "fill", width: 480, height: 360 });
    expect(result.framerate).toBe(30);
    expect(result.trim).toBe(10);
    expect(result.outputFormat).toBe("webm");
    expect(result.sourceUrl).toBe("https://example.com/video.mp4");
  });

  it("rejects invalid framerate", () => {
    expect(() =>
      parseProcessingUrl(
        "/resize:fill:480:360/fr:0/plain/https://example.com/video.mp4",
      ),
    ).toThrow();
  });

  it("rejects invalid trim", () => {
    expect(() =>
      parseProcessingUrl(
        "/resize:fill:480:360/tr:-5/plain/https://example.com/video.mp4",
      ),
    ).toThrowErrorMatchingInlineSnapshot(`
      [ZodError: [
        {
          "origin": "number",
          "code": "too_small",
          "minimum": 0,
          "inclusive": false,
          "path": [
            "trim"
          ],
          "message": "Too small: expected number to be >0"
        }
      ]]
    `);
  });

  it("parses @webm output format", () => {
    const result = parseProcessingUrl(
      "/resize:fill:480:360/plain/https://example.com/video.mp4@webm",
    );
    expect(result.outputFormat).toBe("webm");
    expect(result.sourceUrl).toBe("https://example.com/video.mp4");
  });

  it("parses @mp4 output format explicitly", () => {
    const result = parseProcessingUrl(
      "/resize:fill:480:360/plain/https://example.com/video.mov@mp4",
    );
    expect(result.outputFormat).toBe("mp4");
    expect(result.sourceUrl).toBe("https://example.com/video.mov");
  });

  it("defaults to mp4 when no format suffix on video", () => {
    const result = parseProcessingUrl(
      "/resize:fill:480:360/plain/https://example.com/video.mp4",
    );
    expect(result.outputFormat).toBe("mp4");
  });
});

describe("image processing options", () => {
  it("parses standalone width and height", () => {
    const result = parseProcessingUrl(
      "/w:300/h:200/plain/https://example.com/photo.jpg",
    );
    expect(result.resize).toEqual({ type: "fit", width: 300, height: 200 });
  });

  it("parses size shorthand", () => {
    const result = parseProcessingUrl(
      "/s:400:300/plain/https://example.com/photo.jpg",
    );
    expect(result.resize).toEqual({ type: "fit", width: 400, height: 300 });
  });

  it("parses quality option", () => {
    const result = parseProcessingUrl(
      "/w:300/q:85/plain/https://example.com/photo.jpg",
    );
    expect(result.quality).toBe(85);
  });

  it("parses blur option", () => {
    const result = parseProcessingUrl(
      "/w:300/bl:5/plain/https://example.com/photo.jpg",
    );
    expect(result.blur).toBe(5);
  });

  it("parses sharpen option", () => {
    const result = parseProcessingUrl(
      "/w:300/sh:1.5/plain/https://example.com/photo.jpg",
    );
    expect(result.sharpen).toBe(1.5);
  });

  it("parses rotate option", () => {
    const result = parseProcessingUrl(
      "/w:300/rot:90/plain/https://example.com/photo.jpg",
    );
    expect(result.rotate).toBe(90);
  });

  it("parses auto_rotate option", () => {
    const result = parseProcessingUrl(
      "/w:300/ar:1/plain/https://example.com/photo.jpg",
    );
    expect(result.autoRotate).toBe(true);
  });

  it("parses background as hex", () => {
    const result = parseProcessingUrl(
      "/w:300/bg:ff0000/plain/https://example.com/photo.jpg",
    );
    expect(result.background).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("parses background as RGB", () => {
    const result = parseProcessingUrl(
      "/w:300/bg:128:64:32/plain/https://example.com/photo.jpg",
    );
    expect(result.background).toEqual({ r: 128, g: 64, b: 32 });
  });

  it("parses padding option", () => {
    const result = parseProcessingUrl(
      "/w:300/pd:10:20:10:20/plain/https://example.com/photo.jpg",
    );
    expect(result.padding).toEqual({
      top: 10,
      right: 20,
      bottom: 10,
      left: 20,
    });
  });

  it("parses uniform padding", () => {
    const result = parseProcessingUrl(
      "/w:300/pd:15/plain/https://example.com/photo.jpg",
    );
    expect(result.padding).toEqual({
      top: 15,
      right: 15,
      bottom: 15,
      left: 15,
    });
  });

  it("parses strip_metadata option", () => {
    const result = parseProcessingUrl(
      "/w:300/sm:1/plain/https://example.com/photo.jpg",
    );
    expect(result.stripMetadata).toBe(true);
  });

  it("parses enlarge option", () => {
    const result = parseProcessingUrl(
      "/w:300/el:1/plain/https://example.com/photo.jpg",
    );
    expect(result.enlarge).toBe(true);
  });

  it("parses crop option", () => {
    const result = parseProcessingUrl(
      "/c:200:100:ce/w:300/plain/https://example.com/photo.jpg",
    );
    expect(result.crop).toEqual({ width: 200, height: 100, gravity: "ce" });
  });

  it("parses gravity option", () => {
    const result = parseProcessingUrl(
      "/w:300/g:no/plain/https://example.com/photo.jpg",
    );
    expect(result.gravity).toBe("no");
  });

  it("parses format option as override", () => {
    const result = parseProcessingUrl(
      "/w:300/f:webp/plain/https://example.com/photo.jpg",
    );
    expect(result.outputFormat).toBe("webp");
  });

  it("parses image format suffixes", () => {
    for (const fmt of ["jpg", "png", "webp", "avif", "gif"]) {
      const result = parseProcessingUrl(
        `/w:300/plain/https://example.com/photo.bmp@${fmt}`,
      );
      expect(result.outputFormat).toBe(fmt);
    }
  });

  it("normalises jpeg to jpg", () => {
    const result = parseProcessingUrl(
      "/w:300/plain/https://example.com/photo.bmp@jpeg",
    );
    expect(result.outputFormat).toBe("jpg");
  });

  it("defaults to jpg for image source URLs", () => {
    const result = parseProcessingUrl(
      "/w:300/plain/https://example.com/photo.png",
    );
    expect(result.outputFormat).toBe("jpg");
  });

  it("allows no resize for image pass-through", () => {
    const result = parseProcessingUrl(
      "/q:80/plain/https://example.com/photo.jpg",
    );
    expect(result.resize).toBeUndefined();
    expect(result.quality).toBe(80);
  });

  it("parses combined image options", () => {
    const result = parseProcessingUrl(
      "/rs:fill:400:300/q:80/bl:2/rot:90/bg:ffffff/plain/https://example.com/photo.png@webp",
    );
    expect(result.resize).toEqual({ type: "fill", width: 400, height: 300 });
    expect(result.quality).toBe(80);
    expect(result.blur).toBe(2);
    expect(result.rotate).toBe(90);
    expect(result.background).toEqual({ r: 255, g: 255, b: 255 });
    expect(result.outputFormat).toBe("webp");
  });
});

describe("isImageUrl / isVideoUrl", () => {
  it("returns image for image output formats", () => {
    const result = parseProcessingUrl(
      "/w:300/plain/https://example.com/photo.bmp@webp",
    );
    expect(isImageUrl(result)).toBe(true);
    expect(isVideoUrl(result)).toBe(false);
  });

  it("returns video for video output formats", () => {
    const result = parseProcessingUrl(
      "/resize:fill:480:360/plain/https://example.com/video.mp4@mp4",
    );
    expect(isVideoUrl(result)).toBe(true);
    expect(isImageUrl(result)).toBe(false);
  });

  it("returns image when source URL has image extension", () => {
    const result = parseProcessingUrl(
      "/w:300/plain/https://example.com/photo.png",
    );
    expect(isImageUrl(result)).toBe(true);
  });

  it("returns video when framerate is set", () => {
    const result = parseProcessingUrl(
      "/resize:fill:480:360/fr:30/plain/https://example.com/file",
    );
    expect(isVideoUrl(result)).toBe(true);
  });
});
