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

describe("resizing_algorithm", () => {
  it("parses CPU resizing_algorithm", () => {
    const result = parseProcessingUrl(
      "/ra:lanczos3/w:100/plain/https://example.com/photo.jpg",
    );
    expect(result.resizingAlgorithm).toEqual({
      mode: "cpu",
      algorithm: "lanczos3",
    });
  });

  it("parses GPU scaler", () => {
    const result = parseProcessingUrl(
      "/ra:gpu:scale_npp/resize:fill:480:360/plain/https://example.com/video.mp4",
    );
    expect(result.resizingAlgorithm).toEqual({
      mode: "gpu",
      scaler: "scale_npp",
    });
  });

  it("parses GPU scaler with interpolation algorithm", () => {
    const result = parseProcessingUrl(
      "/ra:gpu:scale_npp:cubic/resize:fill:480:360/plain/https://example.com/video.mp4",
    );
    expect(result.resizingAlgorithm).toEqual({
      mode: "gpu",
      scaler: "scale_npp",
      algorithm: "cubic",
    });
  });

  it("rejects interpolation algorithm on non-npp GPU scaler", () => {
    expect(() =>
      parseProcessingUrl(
        "/ra:gpu:scale_cuda:cubic/w:100/plain/https://example.com/video.mp4",
      ),
    ).toThrow("only supported with scale_npp");
  });

  it("defaults to no resizing algorithm (cuvid used at runtime for GPU video)", () => {
    const result = parseProcessingUrl(
      "/resize:force:480:360/plain/https://example.com/video.mp4",
    );
    expect(result.resizingAlgorithm).toBeUndefined();
  });

  it("rejects invalid resizing_algorithm", () => {
    expect(() =>
      parseProcessingUrl(
        "/ra:invalid/w:100/plain/https://example.com/photo.jpg",
      ),
    ).toThrow();
  });
});

describe("gravity", () => {
  it("parses compass gravity", () => {
    const result = parseProcessingUrl(
      "/c:100:75/g:nowe/w:100/plain/https://example.com/photo.jpg",
    );
    expect(result.gravity).toBe("nowe");
  });

  it("parses focus point gravity", () => {
    const result = parseProcessingUrl(
      "/c:100:75/g:fp:0.3:0.7/w:100/plain/https://example.com/photo.jpg",
    );
    expect(result.gravity).toEqual({ type: "fp", x: 0.3, y: 0.7 });
  });

  it("parses focus point gravity in crop", () => {
    const result = parseProcessingUrl(
      "/c:100:75:fp:0.5:0.5/w:100/plain/https://example.com/photo.jpg",
    );
    expect(result.crop?.gravity).toEqual({ type: "fp", x: 0.5, y: 0.5 });
  });

  it("rejects focus point with out-of-range values", () => {
    expect(() =>
      parseProcessingUrl(
        "/g:fp:1.5:0.5/w:100/plain/https://example.com/photo.jpg",
      ),
    ).toThrow("between 0 and 1");
  });

  it("rejects smart gravity as not implemented", () => {
    expect(() =>
      parseProcessingUrl("/g:sm/w:100/plain/https://example.com/photo.jpg"),
    ).toThrow("not implemented");
  });

  it("rejects object gravity as not implemented", () => {
    expect(() =>
      parseProcessingUrl(
        "/g:obj:face/w:100/plain/https://example.com/photo.jpg",
      ),
    ).toThrow("not implemented");
  });
});

describe("pro options return 400", () => {
  it("rejects crop_aspect_ratio", () => {
    expect(() =>
      parseProcessingUrl("/car:16:9/w:100/plain/https://example.com/photo.jpg"),
    ).toThrow("not implemented");
  });

  it("rejects objects_position", () => {
    expect(() =>
      parseProcessingUrl(
        "/op:0.5:0.5/w:100/plain/https://example.com/photo.jpg",
      ),
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
