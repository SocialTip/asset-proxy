import { getImageUrl } from "../src/get-image-url.js";
import type { AssetProxyServiceConfig } from "../src/index.js";

const BASE_URL = "https://assets.example.com";
const SRC = "https://example.com/photo.jpg";

function config(
  overrides?: Partial<AssetProxyServiceConfig>,
): AssetProxyServiceConfig {
  return { baseUrl: BASE_URL, ...overrides };
}

describe("getImageUrl", () => {
  it("generates a basic URL with no processing options", () => {
    expect(getImageUrl({ src: SRC }, config())).toMatchInlineSnapshot(
      `"https://assets.example.com/insecure/plain/https://example.com/photo.jpg"`,
    );
  });

  it("generates a URL with resize options", () => {
    expect(
      getImageUrl(
        { src: SRC, resize: { type: "fit", width: 800, height: 600 } },
        config(),
      ),
    ).toMatchInlineSnapshot(
      `"https://assets.example.com/insecure/rs:fit:800:600/plain/https://example.com/photo.jpg"`,
    );
  });

  it("generates a URL with quality", () => {
    expect(
      getImageUrl({ src: SRC, quality: 75 }, config()),
    ).toMatchInlineSnapshot(
      `"https://assets.example.com/insecure/q:75/plain/https://example.com/photo.jpg"`,
    );
  });

  it("generates a URL with output format", () => {
    expect(
      getImageUrl({ src: SRC, outputFormat: "webp" }, config()),
    ).toMatchInlineSnapshot(
      `"https://assets.example.com/insecure/f:webp/plain/https://example.com/photo.jpg"`,
    );
  });

  it("generates a URL with blur", () => {
    expect(getImageUrl({ src: SRC, blur: 10 }, config())).toMatchInlineSnapshot(
      `"https://assets.example.com/insecure/bl:10/plain/https://example.com/photo.jpg"`,
    );
  });

  it("generates a URL with sharpen", () => {
    expect(
      getImageUrl({ src: SRC, sharpen: 3 }, config()),
    ).toMatchInlineSnapshot(
      `"https://assets.example.com/insecure/sh:3/plain/https://example.com/photo.jpg"`,
    );
  });

  it("generates a URL with crop", () => {
    expect(
      getImageUrl({ src: SRC, crop: { width: 200, height: 200 } }, config()),
    ).toMatchInlineSnapshot(
      `"https://assets.example.com/insecure/c:200:200/plain/https://example.com/photo.jpg"`,
    );
  });

  it("generates a URL with crop and gravity", () => {
    expect(
      getImageUrl(
        { src: SRC, crop: { width: 200, height: 200, gravity: "ce" } },
        config(),
      ),
    ).toMatchInlineSnapshot(
      `"https://assets.example.com/insecure/c:200:200:ce/plain/https://example.com/photo.jpg"`,
    );
  });

  it("generates a URL with gravity", () => {
    expect(
      getImageUrl({ src: SRC, gravity: "ce" }, config()),
    ).toMatchInlineSnapshot(
      `"https://assets.example.com/insecure/g:ce/plain/https://example.com/photo.jpg"`,
    );
  });

  it("generates a URL with focal-point gravity", () => {
    expect(
      getImageUrl(
        { src: SRC, gravity: { type: "fp", x: 0.3, y: 0.7 } },
        config(),
      ),
    ).toMatchInlineSnapshot(
      `"https://assets.example.com/insecure/g:fp:0.3:0.7/plain/https://example.com/photo.jpg"`,
    );
  });

  it("generates a URL with colour effects", () => {
    expect(
      getImageUrl(
        { src: SRC, brightness: 20, contrast: 1.5, saturation: 0.5 },
        config(),
      ),
    ).toMatchInlineSnapshot(
      `"https://assets.example.com/insecure/br:20/co:1.5/sa:0.5/plain/https://example.com/photo.jpg"`,
    );
  });

  it("generates a URL with monochrome", () => {
    expect(
      getImageUrl(
        { src: SRC, monochrome: { intensity: 1, colour: "FF0000" } },
        config(),
      ),
    ).toMatchInlineSnapshot(
      `"https://assets.example.com/insecure/mc:1:FF0000/plain/https://example.com/photo.jpg"`,
    );
  });

  it("generates a URL with video options", () => {
    expect(
      getImageUrl(
        {
          src: "https://example.com/video.mp4",
          framerate: 24,
          cut: 10,
          mute: true,
        },
        config(),
      ),
    ).toMatchInlineSnapshot(
      `"https://assets.example.com/insecure/ct:10/fr:24/mu:1/plain/https://example.com/video.mp4"`,
    );
  });

  it("generates a URL with signing config", () => {
    expect(
      getImageUrl(
        { src: SRC },
        config({
          signingKey: "736563726574",
          signingSalt: "68656c6c6f",
        }),
      ),
    ).toMatchInlineSnapshot(
      `"https://assets.example.com/3Ywl877on0hR0VVzVTInJnfjDHY5Gpj90sj28uw88U0/plain/https://example.com/photo.jpg"`,
    );
  });

  it("generates a URL with encryption config", () => {
    expect(
      getImageUrl(
        { src: SRC },
        config({
          encryptionKey:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          deterministicEncryption: true,
        }),
      ),
    ).toMatchInlineSnapshot(
      `"https://assets.example.com/insecure/enc/NWNkNzZkOTZiYzJmMmFlY3Be8bupnahLBiXYDPx3gGN39ik0K2cy9XjAVCmLQi5-"`,
    );
  });

  it("combines multiple options", () => {
    expect(
      getImageUrl(
        {
          src: SRC,
          resize: { type: "fill", width: 640, height: 480 },
          quality: 90,
          outputFormat: "avif",
          blur: 2,
        },
        config(),
      ),
    ).toMatchInlineSnapshot(
      `"https://assets.example.com/insecure/bl:2/f:avif/q:90/rs:fill:640:480/plain/https://example.com/photo.jpg"`,
    );
  });

  it("generates a URL with rotate and flip", () => {
    expect(
      getImageUrl(
        { src: SRC, rotate: 90, flip: { horizontal: true, vertical: false } },
        config(),
      ),
    ).toMatchInlineSnapshot(
      `"https://assets.example.com/insecure/fl:1:0/rot:90/plain/https://example.com/photo.jpg"`,
    );
  });

  it("generates a URL with background and padding", () => {
    expect(
      getImageUrl(
        {
          src: SRC,
          background: { r: 255, g: 0, b: 0 },
          padding: { top: 10, right: 20, bottom: 10, left: 20 },
        },
        config(),
      ),
    ).toMatchInlineSnapshot(
      `"https://assets.example.com/insecure/bg:255:0:0/pd:10:20:10:20/plain/https://example.com/photo.jpg"`,
    );
  });

  it("generates a URL with pixelate", () => {
    expect(
      getImageUrl({ src: SRC, pixelate: 5 }, config()),
    ).toMatchInlineSnapshot(
      `"https://assets.example.com/insecure/px:5/plain/https://example.com/photo.jpg"`,
    );
  });

  it("generates a URL with metadata options", () => {
    expect(
      getImageUrl(
        { src: SRC, stripMetadata: true, keepCopyright: true },
        config(),
      ),
    ).toMatchInlineSnapshot(
      `"https://assets.example.com/insecure/kcr:1/sm:1/plain/https://example.com/photo.jpg"`,
    );
  });
});
