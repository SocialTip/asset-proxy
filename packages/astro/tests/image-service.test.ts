import { getImage } from "astro/assets";
import type { ImageService } from "astro";
import service from "../src/index.js";
import type { AssetProxyServiceConfig } from "../src/index.js";

const BASE_URL = "https://assets.example.com";
const SRC = "https://example.com/photo.jpg";

function makeImageConfig(config?: Partial<AssetProxyServiceConfig>) {
  return {
    domains: [] as string[],
    remotePatterns: [] as { protocol?: string; hostname: string }[],
    service: {
      entrypoint: "@socialtip/asset-proxy-astro",
      config: {
        baseUrl: BASE_URL,
        ...config,
      },
    },
  };
}

beforeEach(() => {
  globalThis.astroAsset = { imageService: service as ImageService };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).astroAsset;
});

describe("getImage integration", () => {
  it("generates a basic URL with no processing options", async () => {
    const result = await getImage({ src: SRC }, makeImageConfig());
    expect(result.src).toMatchInlineSnapshot(
      `"https://assets.example.com/_/plain/https://example.com/photo.jpg"`,
    );
  });

  it("generates a URL with width and height", async () => {
    const result = await getImage(
      { src: SRC, width: 800, height: 600 },
      makeImageConfig(),
    );
    expect(result.src).toMatchInlineSnapshot(
      `"https://assets.example.com/_/rs:fit:800:600/plain/https://example.com/photo.jpg"`,
    );
  });

  it("generates a URL with width only", async () => {
    const result = await getImage({ src: SRC, width: 400 }, makeImageConfig());
    expect(result.src).toMatchInlineSnapshot(
      `"https://assets.example.com/_/rs:fit:400:0/plain/https://example.com/photo.jpg"`,
    );
  });

  it("generates a URL with quality as a number", async () => {
    const result = await getImage({ src: SRC, quality: 75 }, makeImageConfig());
    expect(result.src).toMatchInlineSnapshot(
      `"https://assets.example.com/_/q:75/plain/https://example.com/photo.jpg"`,
    );
  });

  it("generates a URL with quality preset", async () => {
    const result = await getImage(
      { src: SRC, quality: "high" },
      makeImageConfig(),
    );
    expect(result.src).toMatchInlineSnapshot(
      `"https://assets.example.com/_/q:80/plain/https://example.com/photo.jpg"`,
    );
  });

  it("generates a URL with output format", async () => {
    const result = await getImage(
      { src: SRC, format: "webp" },
      makeImageConfig(),
    );
    expect(result.src).toMatchInlineSnapshot(
      `"https://assets.example.com/_/plain/https://example.com/photo.jpg@webp"`,
    );
  });

  it("normalises jpeg format to jpg", async () => {
    const result = await getImage(
      { src: SRC, format: "jpeg" },
      makeImageConfig(),
    );
    expect(result.src).toMatchInlineSnapshot(
      `"https://assets.example.com/_/plain/https://example.com/photo.jpg@jpg"`,
    );
  });

  it("maps fit=cover to fill resizing type", async () => {
    const result = await getImage(
      { src: SRC, width: 300, height: 300, fit: "cover" },
      makeImageConfig(),
    );
    expect(result.src).toMatchInlineSnapshot(
      `"https://assets.example.com/_/rs:fill:300:300/plain/https://example.com/photo.jpg"`,
    );
  });

  it("maps fit=contain to fit resizing type", async () => {
    const result = await getImage(
      { src: SRC, width: 300, height: 300, fit: "contain" },
      makeImageConfig(),
    );
    expect(result.src).toMatchInlineSnapshot(
      `"https://assets.example.com/_/rs:fit:300:300/plain/https://example.com/photo.jpg"`,
    );
  });

  it("maps fit=fill to force resizing type", async () => {
    const result = await getImage(
      { src: SRC, width: 300, height: 300, fit: "fill" },
      makeImageConfig(),
    );
    expect(result.src).toMatchInlineSnapshot(
      `"https://assets.example.com/_/rs:force:300:300/plain/https://example.com/photo.jpg"`,
    );
  });

  it("maps fit=scale-down to fit resizing type", async () => {
    const result = await getImage(
      { src: SRC, width: 300, height: 300, fit: "scale-down" },
      makeImageConfig(),
    );
    expect(result.src).toMatchInlineSnapshot(
      `"https://assets.example.com/_/rs:fit:300:300/plain/https://example.com/photo.jpg"`,
    );
  });

  it("combines all options", async () => {
    const result = await getImage(
      {
        src: SRC,
        width: 640,
        height: 480,
        quality: 90,
        format: "avif",
        fit: "cover",
      },
      makeImageConfig(),
    );
    expect(result.src).toMatchInlineSnapshot(
      `"https://assets.example.com/_/rs:fill:640:480/q:90/plain/https://example.com/photo.jpg@avif"`,
    );
  });

  it("resolves ImageMetadata src and infers height from aspect ratio", async () => {
    const meta = {
      src: "/assets/photo.abc123.jpg",
      width: 1920,
      height: 1080,
      format: "jpg" as const,
    };
    const result = await getImage({ src: meta, width: 400 }, makeImageConfig());
    expect(result.src).toMatchInlineSnapshot(
      `"https://assets.example.com/_/rs:fit:400:225/plain//assets/photo.abc123.jpg"`,
    );
  });

  it("uses signing config when provided", async () => {
    const result = await getImage(
      { src: SRC },
      makeImageConfig({
        signingKey: "736563726574",
        signingSalt: "68656c6c6f",
        deterministicEncryption: true,
      }),
    );
    expect(result.src).toMatchInlineSnapshot(
      `"https://assets.example.com/3Ywl877on0hR0VVzVTInJnfjDHY5Gpj90sj28uw88U0/plain/https://example.com/photo.jpg"`,
    );
  });

  it("uses encryption config when provided", async () => {
    const result = await getImage(
      { src: SRC },
      makeImageConfig({
        encryptionKey:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        deterministicEncryption: true,
      }),
    );
    expect(result.src).toMatchInlineSnapshot(
      `"https://assets.example.com/_/enc/XNdtlrwvKuz5k1blTLNJxc2lHaNIK8oYXzPu89BKYD_AyGTTL1aIvY2tfvTWHxvH"`,
    );
  });

  it("returns lazy loading and async decoding by default", async () => {
    const result = await getImage(
      { src: SRC, width: 400, height: 300 },
      makeImageConfig(),
    );
    expect(result.attributes).toMatchInlineSnapshot(`
      {
        "decoding": "async",
        "fetchpriority": "auto",
        "loading": "lazy",
      }
    `);
  });

  it("returns eager loading for priority images", async () => {
    const result = await getImage(
      { src: SRC, width: 400, height: 300, priority: true },
      makeImageConfig(),
    );
    expect(result.attributes).toMatchInlineSnapshot(`
      {
        "decoding": "sync",
        "fetchpriority": "high",
        "loading": "eager",
      }
    `);
  });

  it("strips image service properties from HTML attributes", async () => {
    const result = await getImage(
      {
        src: SRC,
        width: 400,
        height: 300,
        format: "webp",
        quality: 80,
        fit: "cover",
        position: "center",
      },
      makeImageConfig(),
    );
    expect(result.attributes).toMatchInlineSnapshot(`
      {
        "decoding": "async",
        "fetchpriority": "auto",
        "loading": "lazy",
      }
    `);
  });

  it("passes through additional HTML attributes", async () => {
    const result = await getImage(
      { src: SRC, alt: "A photo", class: "hero-image" },
      makeImageConfig(),
    );
    expect(result.attributes).toMatchInlineSnapshot(`
      {
        "alt": "A photo",
        "class": "hero-image",
        "decoding": "async",
        "fetchpriority": "auto",
        "loading": "lazy",
      }
    `);
  });

  it("throws when src is missing", async () => {
    await expect(
      getImage({ src: undefined as unknown as string }, makeImageConfig()),
    ).rejects.toThrow();
  });
});
