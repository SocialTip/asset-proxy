import { createCipheriv, randomBytes } from "node:crypto";

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
    ).toThrowErrorMatchingInlineSnapshot(`
      [ZodError: [
        {
          "origin": "number",
          "code": "too_small",
          "minimum": 0,
          "inclusive": false,
          "path": [
            "framerate"
          ],
          "message": "Too small: expected number to be >0"
        }
      ]]
    `);
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

describe("resize options", () => {
  it("parses standalone resizing type (t)", () => {
    const result = parseProcessingUrl(
      "/t:fill/w:480/h:360/plain/https://example.com/video.mp4",
    );
    expect(result.resize).toEqual({ type: "fill", width: 480, height: 360 });
  });

  it("standalone t overrides resize type", () => {
    const result = parseProcessingUrl(
      "/rs:fit:480:360/t:force/plain/https://example.com/video.mp4",
    );
    expect(result.resize?.type).toBe("force");
  });

  it("parses min-width (mw)", () => {
    const result = parseProcessingUrl(
      "/w:100/mw:200/plain/https://example.com/photo.jpg",
    );
    expect(result.minWidth).toBe(200);
  });

  it("parses min-height (mh)", () => {
    const result = parseProcessingUrl(
      "/w:100/mh:150/plain/https://example.com/photo.jpg",
    );
    expect(result.minHeight).toBe(150);
  });

  it("parses zoom (z) with single value", () => {
    const result = parseProcessingUrl(
      "/rs:fit:100:100/z:2/plain/https://example.com/photo.jpg",
    );
    expect(result.resize).toEqual({ type: "fit", width: 200, height: 200 });
  });

  it("parses zoom (z) with separate x/y", () => {
    const result = parseProcessingUrl(
      "/rs:fit:100:100/z:2:3/plain/https://example.com/photo.jpg",
    );
    expect(result.resize).toEqual({ type: "fit", width: 200, height: 300 });
  });

  it("parses dpr and scales dimensions", () => {
    const result = parseProcessingUrl(
      "/rs:fit:100:100/dpr:2/plain/https://example.com/photo.jpg",
    );
    expect(result.resize).toEqual({ type: "fit", width: 200, height: 200 });
  });

  it("dpr scales padding", () => {
    const result = parseProcessingUrl(
      "/w:100/pd:10/dpr:2/plain/https://example.com/photo.jpg",
    );
    expect(result.padding).toEqual({
      top: 20,
      right: 20,
      bottom: 20,
      left: 20,
    });
  });

  it("parses extend (ex)", () => {
    const result = parseProcessingUrl(
      "/rs:fit:100:100/ex:1:no/plain/https://example.com/photo.jpg",
    );
    expect(result.extend).toEqual({ enabled: true, gravity: "no" });
  });

  it("extend defaults gravity to ce", () => {
    const result = parseProcessingUrl(
      "/rs:fit:100:100/ex:1/plain/https://example.com/photo.jpg",
    );
    expect(result.extend).toEqual({ enabled: true, gravity: "ce" });
  });

  it("parses extend_aspect_ratio (exar)", () => {
    const result = parseProcessingUrl(
      "/rs:fit:100:100/exar:1:so/plain/https://example.com/photo.jpg",
    );
    expect(result.extendAspectRatio).toEqual({
      enabled: true,
      gravity: "so",
    });
  });
});

describe("pro options return 400", () => {
  it("rejects resizing_algorithm", () => {
    expect(() =>
      parseProcessingUrl(
        "/ra:lanczos3/w:100/plain/https://example.com/photo.jpg",
      ),
    ).toThrow("not implemented");
  });

  it("rejects crop_aspect_ratio", () => {
    expect(() =>
      parseProcessingUrl("/car:16:9/w:100/plain/https://example.com/photo.jpg"),
    ).toThrow("not implemented");
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
