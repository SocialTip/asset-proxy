import crypto from "node:crypto";
import {
  generateImageUrl,
  generateImageInfoUrl,
} from "@imgproxy/imgproxy-node";
import { generateUrl, generateInfoUrl } from "../src/index.js";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof crypto>();
  const randomBytesMock = vi.fn(
    (...args: Parameters<typeof crypto.randomBytes>) =>
      actual.randomBytes(...args),
  );
  return {
    ...actual,
    randomBytes: randomBytesMock,
    default: { ...actual, randomBytes: randomBytesMock },
  };
});

const SRC = "https://example.com/photo.jpg";
const KEY_HEX =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SIGNING_KEY = "736563726574";
const SIGNING_SALT = "68656c6c6f";

function imgproxyEncryptIV(url: string): string {
  return Buffer.from(crypto.createHash("sha256").update(url).digest("hex"))
    .subarray(0, 16)
    .toString("hex");
}

describe("imgproxy backward compatibility", () => {
  it("plain URL, no options", () => {
    const ours = generateUrl({ sourceUrl: SRC });
    const theirs = generateImageUrl({
      endpoint: "",
      url: { value: SRC, displayAs: "plain" },
    });

    expect(ours).toMatchInlineSnapshot(
      `"/insecure/plain/https://example.com/photo.jpg"`,
    );
    expect(ours).toBe(theirs);
  });

  it("plain URL with resize", () => {
    const ours = generateUrl({
      sourceUrl: SRC,
      resize: { type: "fill", width: 480, height: 360 },
    });
    const theirs = generateImageUrl({
      endpoint: "",
      url: { value: SRC, displayAs: "plain" },
      options: {
        resize: { resizing_type: "fill", width: 480, height: 360 },
      },
    });

    expect(ours).toMatchInlineSnapshot(
      `"/insecure/rs:fill:480:360/plain/https://example.com/photo.jpg"`,
    );
    expect(ours).toBe(theirs);
  });

  it("plain URL with quality", () => {
    const ours = generateUrl({
      sourceUrl: SRC,
      quality: 80,
    });
    const theirs = generateImageUrl({
      endpoint: "",
      url: { value: SRC, displayAs: "plain" },
      options: { quality: 80 },
    });

    expect(ours).toMatchInlineSnapshot(
      `"/insecure/q:80/plain/https://example.com/photo.jpg"`,
    );
    expect(ours).toBe(theirs);
  });

  it("plain URL with resize, quality, blur, and format", () => {
    const ours = generateUrl({
      sourceUrl: SRC,
      resize: { type: "fill", width: 480, height: 360 },
      quality: 80,
      blur: 5,
      outputFormat: "webp",
    });
    const theirs = generateImageUrl({
      endpoint: "",
      url: { value: SRC, displayAs: "plain" },
      options: {
        resize: { resizing_type: "fill", width: 480, height: 360 },
        quality: 80,
        blur: 5,
        format: "webp",
      },
    });

    expect(ours).toMatchInlineSnapshot(
      `"/insecure/bl:5/f:webp/q:80/rs:fill:480:360/plain/https://example.com/photo.jpg"`,
    );
    expect(ours).toBe(theirs);
  });

  it("plain URL with many options", () => {
    const ours = generateUrl({
      sourceUrl: SRC,
      resize: { type: "fill", width: 480, height: 360 },
      quality: 80,
      blur: 5,
      sharpen: 1.5,
      rotate: 90,
      padding: { top: 10, right: 20, bottom: 10, left: 20 },
      background: { r: 255, g: 0, b: 0 },
      outputFormat: "webp",
    });
    const theirs = generateImageUrl({
      endpoint: "",
      url: { value: SRC, displayAs: "plain" },
      options: {
        resize: { resizing_type: "fill", width: 480, height: 360 },
        quality: 80,
        blur: 5,
        sharpen: 1.5,
        rotate: 90,
        padding: { top: 10, right: 20, bottom: 10, left: 20 },
        background: { r: 255, g: 0, b: 0 },
        format: "webp",
      },
    });

    expect(ours).toMatchInlineSnapshot(
      `"/insecure/bg:255:0:0/bl:5/f:webp/pd:10:20:10:20/q:80/rs:fill:480:360/rot:90/sh:1.5/plain/https://example.com/photo.jpg"`,
    );
    expect(ours).toBe(theirs);
  });

  it("encrypted source URL with deterministic IV", () => {
    const ours = generateUrl(
      { sourceUrl: SRC },
      { encryptionKey: KEY_HEX, deterministicEncryption: true },
    );
    const theirs = generateImageUrl({
      endpoint: "",
      url: { value: SRC, displayAs: "encrypted" },
      encryptKey: KEY_HEX,
      encryptIV: imgproxyEncryptIV(SRC),
    });

    expect(ours).toMatchInlineSnapshot(
      `"/insecure/enc/NWNkNzZkOTZiYzJmMmFlY3Be8bupnahLBiXYDPx3gGN39ik0K2cy9XjAVCmLQi5-"`,
    );
    expect(ours).toBe(theirs);
  });

  it("encrypted source URL with random IV", () => {
    const fakeIV = Buffer.alloc(16, 0xab);
    vi.mocked(crypto.randomBytes).mockReturnValue(fakeIV as never);

    const ours = generateUrl({ sourceUrl: SRC }, { encryptionKey: KEY_HEX });
    const theirs = generateImageUrl({
      endpoint: "",
      url: { value: SRC, displayAs: "encrypted" },
      encryptKey: KEY_HEX,
      encryptIV: fakeIV.toString("hex"),
    });

    expect(ours).toMatchInlineSnapshot(
      `"/insecure/enc/q6urq6urq6urq6urq6urq4-9XgvB94hQA6a_ZKhfi9up_dxwHiQr0opHXWpb7IJH"`,
    );
    expect(ours).toBe(theirs);

    vi.restoreAllMocks();
  });

  it("signed source URL", () => {
    const ours = generateUrl(
      {
        sourceUrl: SRC,
        resize: { type: "fill", width: 480, height: 360 },
      },
      { signingKey: SIGNING_KEY, signingSalt: SIGNING_SALT },
    );
    const theirs = generateImageUrl({
      endpoint: "",
      url: { value: SRC, displayAs: "plain" },
      options: {
        resize: { resizing_type: "fill", width: 480, height: 360 },
      },
      key: SIGNING_KEY,
      salt: SIGNING_SALT,
    });

    expect(ours).toMatchInlineSnapshot(
      `"/s25i5L-eclbtjwQfjOsCAugLq-QIkgthc9Qt8noOWnE/rs:fill:480:360/plain/https://example.com/photo.jpg"`,
    );
    expect(ours).toBe(theirs);
  });

  it("signed and encrypted source URL with options", () => {
    const ours = generateUrl(
      {
        sourceUrl: SRC,
        resize: { type: "fill", width: 480, height: 360 },
        quality: 80,
        outputFormat: "webp",
      },
      {
        encryptionKey: KEY_HEX,
        deterministicEncryption: true,
        signingKey: SIGNING_KEY,
        signingSalt: SIGNING_SALT,
      },
    );
    const theirs = generateImageUrl({
      endpoint: "",
      url: { value: SRC, displayAs: "encrypted" },
      options: {
        resize: { resizing_type: "fill", width: 480, height: 360 },
        quality: 80,
        format: "webp",
      },
      encryptKey: KEY_HEX,
      encryptIV: imgproxyEncryptIV(SRC),
      key: SIGNING_KEY,
      salt: SIGNING_SALT,
    });

    expect(ours).toMatchInlineSnapshot(
      `"/sN4H5lhgyeCFcrMsGvDZufFo5txvr9G29SIqtuZ6Zac/f:webp/q:80/rs:fill:480:360/enc/NWNkNzZkOTZiYzJmMmFlY3Be8bupnahLBiXYDPx3gGN39ik0K2cy9XjAVCmLQi5-"`,
    );
    expect(ours).toBe(theirs);
  });
});

describe("imgproxy backward compatibility: info URL", () => {
  it("plain URL, no options", () => {
    const ours = generateInfoUrl({ sourceUrl: SRC });
    const theirs = generateImageInfoUrl({
      endpoint: "",
      url: { value: SRC, displayAs: "plain" },
    });

    expect(ours).toMatchInlineSnapshot(
      `"/info/insecure/plain/https://example.com/photo.jpg"`,
    );
    expect(ours).toBe(theirs);
  });

  it("encrypted source URL with deterministic IV", () => {
    const ours = generateInfoUrl(
      { sourceUrl: SRC },
      { encryptionKey: KEY_HEX, deterministicEncryption: true },
    );
    const theirs = generateImageInfoUrl({
      endpoint: "",
      url: { value: SRC, displayAs: "encrypted" },
      encryptKey: KEY_HEX,
      encryptIV: imgproxyEncryptIV(SRC),
    });

    expect(ours).toMatchInlineSnapshot(
      `"/info/insecure/enc/NWNkNzZkOTZiYzJmMmFlY3Be8bupnahLBiXYDPx3gGN39ik0K2cy9XjAVCmLQi5-"`,
    );
    expect(ours).toBe(theirs);
  });

  it("encrypted source URL with random IV", () => {
    const fakeIV = Buffer.alloc(16, 0xab);
    vi.mocked(crypto.randomBytes).mockReturnValue(fakeIV as never);

    const ours = generateInfoUrl(
      { sourceUrl: SRC },
      { encryptionKey: KEY_HEX },
    );
    const theirs = generateImageInfoUrl({
      endpoint: "",
      url: { value: SRC, displayAs: "encrypted" },
      encryptKey: KEY_HEX,
      encryptIV: fakeIV.toString("hex"),
    });

    expect(ours).toMatchInlineSnapshot(
      `"/info/insecure/enc/q6urq6urq6urq6urq6urq4-9XgvB94hQA6a_ZKhfi9up_dxwHiQr0opHXWpb7IJH"`,
    );
    expect(ours).toBe(theirs);

    vi.restoreAllMocks();
  });

  it("signed source URL", () => {
    const ours = generateInfoUrl(
      { sourceUrl: SRC },
      { signingKey: SIGNING_KEY, signingSalt: SIGNING_SALT },
    );
    const theirs = generateImageInfoUrl({
      endpoint: "",
      url: { value: SRC, displayAs: "plain" },
      key: SIGNING_KEY,
      salt: SIGNING_SALT,
    });

    expect(ours).toMatchInlineSnapshot(
      `"/info/3Ywl877on0hR0VVzVTInJnfjDHY5Gpj90sj28uw88U0/plain/https://example.com/photo.jpg"`,
    );
    expect(ours).toBe(theirs);
  });

  it("signed and encrypted source URL", () => {
    const ours = generateInfoUrl(
      { sourceUrl: SRC },
      {
        encryptionKey: KEY_HEX,
        deterministicEncryption: true,
        signingKey: SIGNING_KEY,
        signingSalt: SIGNING_SALT,
      },
    );
    const theirs = generateImageInfoUrl({
      endpoint: "",
      url: { value: SRC, displayAs: "encrypted" },
      encryptKey: KEY_HEX,
      encryptIV: imgproxyEncryptIV(SRC),
      key: SIGNING_KEY,
      salt: SIGNING_SALT,
    });

    expect(ours).toMatchInlineSnapshot(
      `"/info/X0h7BVflNWOxU_OwVbHbMTgUff3ko55M_eI8r7yeELU/enc/NWNkNzZkOTZiYzJmMmFlY3Be8bupnahLBiXYDPx3gGN39ik0K2cy9XjAVCmLQi5-"`,
    );
    expect(ours).toBe(theirs);
  });

  it("with exif option", () => {
    const ours = generateInfoUrl({ sourceUrl: SRC }, undefined, { exif: true });
    const theirs = generateImageInfoUrl({
      endpoint: "",
      url: { value: SRC, displayAs: "plain" },
      options: { exif: 1 },
    });

    expect(ours).toMatchInlineSnapshot(
      `"/info/insecure/exif:t/plain/https://example.com/photo.jpg"`,
    );
    expect(ours).toBe(theirs);
  });

  it("with iptc option", () => {
    const ours = generateInfoUrl({ sourceUrl: SRC }, undefined, { iptc: true });
    const theirs = generateImageInfoUrl({
      endpoint: "",
      url: { value: SRC, displayAs: "plain" },
      options: { iptc: 1 },
    });

    expect(ours).toMatchInlineSnapshot(
      `"/info/insecure/iptc:t/plain/https://example.com/photo.jpg"`,
    );
    expect(ours).toBe(theirs);
  });

  it("with xmp option", () => {
    const ours = generateInfoUrl({ sourceUrl: SRC }, undefined, { xmp: true });
    const theirs = generateImageInfoUrl({
      endpoint: "",
      url: { value: SRC, displayAs: "plain" },
      options: { xmp: 1 },
    });

    expect(ours).toMatchInlineSnapshot(
      `"/info/insecure/xmp:t/plain/https://example.com/photo.jpg"`,
    );
    expect(ours).toBe(theirs);
  });
});
