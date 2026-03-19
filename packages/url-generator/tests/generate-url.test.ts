import { generateUrl } from "../src/index.js";
import {
  parseProcessingUrl,
  decryptSourceUrl,
  verifySignature,
} from "@socialtip/asset-proxy-url-parser";
import { createHmac } from "node:crypto";

const SRC = "https://example.com/photo.jpg";
const KEY_HEX =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEY = Buffer.from(KEY_HEX, "hex");
const SIGNING_KEY = "736563726574";
const SIGNING_SALT = "68656c6c6f";

describe("generateUrl", () => {
  it("generates a basic URL with no options", () => {
    const url = generateUrl({ sourceUrl: SRC });
    expect(url).toBe(`/insecure/plain/${SRC}`);
  });

  it("generates a URL with output format", () => {
    const url = generateUrl({ sourceUrl: SRC, outputFormat: "webp" });
    expect(url).toBe(`/insecure/f:webp/plain/${SRC}`);
  });

  it("generates a URL with resize", () => {
    const url = generateUrl({
      sourceUrl: SRC,
      resize: { type: "fill", width: 480, height: 360 },
    });
    expect(url).toBe(`/insecure/rs:fill:480:360/plain/${SRC}`);
  });

  it("generates a URL with multiple options", () => {
    const url = generateUrl({
      sourceUrl: SRC,
      outputFormat: "webp",
      resize: { type: "fit", width: 300, height: 0 },
      quality: 80,
      blur: 5,
    });
    expect(url).toBe(`/insecure/bl:5/f:webp/q:80/rs:fit:300:0/plain/${SRC}`);
  });

  it("omits default brightness/contrast/saturation", () => {
    const url = generateUrl({
      sourceUrl: SRC,
      brightness: 0,
      contrast: 1,
      saturation: 1,
    });
    expect(url).toBe(`/insecure/plain/${SRC}`);
  });

  it("includes non-default brightness/contrast/saturation", () => {
    const url = generateUrl({
      sourceUrl: SRC,
      brightness: 50,
      contrast: 1.5,
      saturation: 0.5,
    });
    expect(url).toBe(`/insecure/br:50/co:1.5/sa:0.5/plain/${SRC}`);
  });

  it("generates boolean options", () => {
    const url = generateUrl({
      sourceUrl: SRC,
      enlarge: true,
      stripMetadata: false,
    });
    expect(url).toBe(`/insecure/el:1/sm:0/plain/${SRC}`);
  });

  it("generates crop with gravity", () => {
    const url = generateUrl({
      sourceUrl: SRC,
      crop: { width: 100, height: 75, gravity: { type: "fp", x: 0.3, y: 0.7 } },
    });
    expect(url).toBe(`/insecure/c:100:75:fp:0.3:0.7/plain/${SRC}`);
  });

  it("generates padding", () => {
    const url = generateUrl({
      sourceUrl: SRC,
      padding: { top: 10, right: 20, bottom: 10, left: 20 },
    });
    expect(url).toBe(`/insecure/pd:10:20:10:20/plain/${SRC}`);
  });

  it("encrypts the source URL when encryptionKey is provided", () => {
    const url = generateUrl({ sourceUrl: SRC }, { encryptionKey: KEY_HEX });

    expect(url).toMatch(/^\/insecure\/enc\//);
    const encPart = url.replace("/insecure/enc/", "");
    const decrypted = decryptSourceUrl(encPart, KEY);
    expect(decrypted).toBe(SRC);
  });

  it("signs the URL when signingKey and signingSalt are provided", () => {
    const url = generateUrl(
      { sourceUrl: SRC, resize: { type: "fill", width: 480, height: 360 } },
      { signingKey: SIGNING_KEY, signingSalt: SIGNING_SALT },
    );

    const sigEnd = url.indexOf("/", 1);
    const signature = url.slice(1, sigEnd);
    const pathAfterSig = url.slice(sigEnd);

    const hmac = createHmac("sha256", Buffer.from(SIGNING_KEY, "hex"));
    hmac.update(Buffer.from(SIGNING_SALT, "hex"));
    hmac.update(pathAfterSig);
    const expected = hmac.digest("base64url");

    expect(signature).toBe(expected);
  });

  it("generates a signed, encrypted URL that round-trips through the parser", () => {
    const url = generateUrl(
      {
        sourceUrl: SRC,
        outputFormat: "webp",
        resize: { type: "fill", width: 480, height: 360 },
      },
      {
        encryptionKey: KEY_HEX,
        signingKey: SIGNING_KEY,
        signingSalt: SIGNING_SALT,
      },
    );

    const pathAfterSig = verifySignature(url, {
      signingKey: Buffer.from(SIGNING_KEY, "hex"),
      signingSalt: Buffer.from(SIGNING_SALT, "hex"),
    });
    const parsed = parseProcessingUrl(pathAfterSig, { encryptionKey: KEY });

    expect(parsed.sourceUrl).toBe(SRC);
    expect(parsed.outputFormat).toBe("webp");
    expect(parsed.resize).toEqual({ type: "fill", width: 480, height: 360 });
  });

  it("generates deterministic URLs when deterministicEncryption is enabled", () => {
    const config = { encryptionKey: KEY_HEX, deterministicEncryption: true };

    const url1 = generateUrl({ sourceUrl: SRC, quality: 80 }, config);
    const url2 = generateUrl({ sourceUrl: SRC, quality: 80 }, config);

    expect(url1).toBe(url2);

    const encPart = url1.replace("/insecure/q:80/enc/", "");
    const decrypted = decryptSourceUrl(encPart, KEY);
    expect(decrypted).toBe(SRC);
  });

  it("generates deterministic signed, encrypted URLs that are cacheable", () => {
    const config = {
      encryptionKey: KEY_HEX,
      deterministicEncryption: true,
      signingKey: SIGNING_KEY,
      signingSalt: SIGNING_SALT,
    };
    const opts = {
      sourceUrl: SRC,
      outputFormat: "webp" as const,
      resize: { type: "fill" as const, width: 480, height: 360 },
    };

    const url1 = generateUrl(opts, config);
    const url2 = generateUrl(opts, config);

    expect(url1).toBe(url2);
    expect(url1).toMatchInlineSnapshot(
      `"/2TK32eqmtGSST5tPT7m2bbBUwKSdZC_fuvrr0ivtgto/f:webp/rs:fill:480:360/enc/NWNkNzZkOTZiYzJmMmFlY3Be8bupnahLBiXYDPx3gGN39ik0K2cy9XjAVCmLQi5-"`,
    );

    const pathAfterSig = verifySignature(url1, {
      signingKey: Buffer.from(SIGNING_KEY, "hex"),
      signingSalt: Buffer.from(SIGNING_SALT, "hex"),
    });
    const parsed = parseProcessingUrl(pathAfterSig, { encryptionKey: KEY });

    expect(parsed.sourceUrl).toBe(SRC);
    expect(parsed.outputFormat).toBe("webp");
    expect(parsed.resize).toEqual({ type: "fill", width: 480, height: 360 });
  });

  it("generates best format option", () => {
    const url = generateUrl({
      sourceUrl: SRC,
      bestFormat: true,
    });
    expect(url).toBe(`/insecure/f:best/plain/${SRC}`);
  });

  it("round-trips bestFormat through parseProcessingUrl", () => {
    const url = generateUrl({
      sourceUrl: SRC,
      bestFormat: true,
      resize: { type: "fill", width: 480, height: 360 },
    });
    const pathAfterSig = url.slice(url.indexOf("/", 1));
    const parsed = parseProcessingUrl(pathAfterSig);
    expect(parsed.bestFormat).toBe(true);
    expect(parsed.sourceUrl).toBe(SRC);
  });

  it("generates skip_processing option", () => {
    const url = generateUrl({
      sourceUrl: SRC,
      skipProcessing: ["jpg", "png"],
    });
    expect(url).toBe(`/insecure/skp:jpg:png/plain/${SRC}`);
  });

  it("generates raw option", () => {
    const url = generateUrl({ sourceUrl: SRC, raw: true });
    expect(url).toBe(`/insecure/raw:1/plain/${SRC}`);
  });

  it("generates cache_buster option", () => {
    const url = generateUrl({ sourceUrl: SRC, cacheBuster: "v2" });
    expect(url).toBe(`/insecure/cb:v2/plain/${SRC}`);
  });

  it("generates expires option", () => {
    const url = generateUrl({ sourceUrl: SRC, expires: 1700000000 });
    expect(url).toBe(`/insecure/exp:1700000000/plain/${SRC}`);
  });

  it("generates filename option", () => {
    const url = generateUrl({ sourceUrl: SRC, filename: "photo.jpg" });
    expect(url).toBe(`/insecure/fn:photo.jpg/plain/${SRC}`);
  });

  it("generates return_attachment option", () => {
    const url = generateUrl({ sourceUrl: SRC, returnAttachment: true });
    expect(url).toBe(`/insecure/att:1/plain/${SRC}`);
  });

  it("round-trips miscellaneous options through parseProcessingUrl", () => {
    const url = generateUrl({
      sourceUrl: SRC,
      skipProcessing: ["jpg", "png"],
      cacheBuster: "abc",
      expires: 1700000000,
      filename: "download.jpg",
      returnAttachment: true,
    });
    const pathAfterSig = url.slice(url.indexOf("/", 1));
    const parsed = parseProcessingUrl(pathAfterSig);
    expect(parsed.skipProcessing).toEqual(["jpg", "png"]);
    expect(parsed.cacheBuster).toBe("abc");
    expect(parsed.expires).toBe(1700000000);
    expect(parsed.filename).toBe("download.jpg");
    expect(parsed.returnAttachment).toBe(true);
  });

  it("round-trips raw option through parseProcessingUrl", () => {
    const url = generateUrl({ sourceUrl: SRC, raw: true });
    const pathAfterSig = url.slice(url.indexOf("/", 1));
    const parsed = parseProcessingUrl(pathAfterSig);
    expect(parsed.raw).toBe(true);
  });

  it("generates security limit options", () => {
    const url = generateUrl({
      sourceUrl: SRC,
      maxSrcResolution: 25,
      maxSrcFileSize: 10485760,
      maxAnimationFrames: 100,
      maxAnimationFrameResolution: 5,
      maxResultDimension: 4096,
    });
    expect(url).toBe(
      `/insecure/mafr:5/maf:100/mrd:4096/msfs:10485760/msr:25/plain/${SRC}`,
    );
  });

  it("round-trips security limit options through parseProcessingUrl", () => {
    const url = generateUrl({
      sourceUrl: SRC,
      maxSrcResolution: 25,
      maxSrcFileSize: 10485760,
      maxAnimationFrames: 100,
      maxAnimationFrameResolution: 5,
      maxResultDimension: 4096,
    });
    const pathAfterSig = url.slice(url.indexOf("/", 1));
    const parsed = parseProcessingUrl(pathAfterSig);
    expect(parsed.maxSrcResolution).toBe(25);
    expect(parsed.maxSrcFileSize).toBe(10485760);
    expect(parsed.maxAnimationFrames).toBe(100);
    expect(parsed.maxAnimationFrameResolution).toBe(5);
    expect(parsed.maxResultDimension).toBe(4096);
  });

  it("generates and round-trips mute option", () => {
    const url = generateUrl({ sourceUrl: SRC, mute: true });
    expect(url).toContain("mu:1");
    const pathAfterSig = url.slice(url.indexOf("/", 1));
    const parsed = parseProcessingUrl(pathAfterSig);
    expect(parsed.mute).toBe(true);
  });

  it("round-trips through parseProcessingUrl", () => {
    const url = generateUrl({
      sourceUrl: SRC,
      outputFormat: "webp",
      resize: { type: "fill", width: 480, height: 360 },
      quality: 80,
      blur: 5,
      sharpen: 1.5,
      rotate: 90,
      flip: { horizontal: true, vertical: false },
      background: { r: 255, g: 0, b: 0 },
      padding: { top: 10, right: 10, bottom: 10, left: 10 },
    });

    // Strip the signature segment for parsing
    const pathAfterSig = url.slice(url.indexOf("/", 1));
    const parsed = parseProcessingUrl(pathAfterSig);

    expect(parsed.sourceUrl).toBe(SRC);
    expect(parsed.outputFormat).toBe("webp");
    expect(parsed.resize).toEqual({ type: "fill", width: 480, height: 360 });
    expect(parsed.quality).toBe(80);
    expect(parsed.blur).toBe(5);
    expect(parsed.sharpen).toBe(1.5);
    expect(parsed.rotate).toBe(90);
    expect(parsed.flip).toEqual({ horizontal: true, vertical: false });
    expect(parsed.background).toEqual({ r: 255, g: 0, b: 0 });
    expect(parsed.padding).toEqual({
      top: 10,
      right: 10,
      bottom: 10,
      left: 10,
    });
  });
});
