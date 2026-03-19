import { generateUrl } from "../src/index.js";
import {
  parseProcessingUrl,
  decryptSourceUrl,
  verifySignature,
} from "@asset-proxy/url-parser";
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
    expect(url).toBe(`/_/plain/${SRC}`);
  });

  it("generates a URL with output format", () => {
    const url = generateUrl({ sourceUrl: SRC, outputFormat: "webp" });
    expect(url).toBe(`/_/plain/${SRC}@webp`);
  });

  it("generates a URL with resize", () => {
    const url = generateUrl({
      sourceUrl: SRC,
      resize: { type: "fill", width: 480, height: 360 },
    });
    expect(url).toBe(`/_/rs:fill:480:360/plain/${SRC}`);
  });

  it("generates a URL with multiple options", () => {
    const url = generateUrl({
      sourceUrl: SRC,
      outputFormat: "webp",
      resize: { type: "fit", width: 300, height: 0 },
      quality: 80,
      blur: 5,
    });
    expect(url).toBe(`/_/rs:fit:300:0/q:80/bl:5/plain/${SRC}@webp`);
  });

  it("omits default brightness/contrast/saturation", () => {
    const url = generateUrl({
      sourceUrl: SRC,
      brightness: 0,
      contrast: 1,
      saturation: 1,
    });
    expect(url).toBe(`/_/plain/${SRC}`);
  });

  it("includes non-default brightness/contrast/saturation", () => {
    const url = generateUrl({
      sourceUrl: SRC,
      brightness: 50,
      contrast: 1.5,
      saturation: 0.5,
    });
    expect(url).toBe(`/_/br:50/co:1.5/sa:0.5/plain/${SRC}`);
  });

  it("generates boolean options", () => {
    const url = generateUrl({
      sourceUrl: SRC,
      enlarge: true,
      stripMetadata: false,
    });
    expect(url).toBe(`/_/el:1/sm:0/plain/${SRC}`);
  });

  it("generates crop with gravity", () => {
    const url = generateUrl({
      sourceUrl: SRC,
      crop: { width: 100, height: 75, gravity: { type: "fp", x: 0.3, y: 0.7 } },
    });
    expect(url).toBe(`/_/c:100:75:fp:0.3:0.7/plain/${SRC}`);
  });

  it("generates padding", () => {
    const url = generateUrl({
      sourceUrl: SRC,
      padding: { top: 10, right: 20, bottom: 10, left: 20 },
    });
    expect(url).toBe(`/_/pd:10:20:10:20/plain/${SRC}`);
  });

  it("encrypts the source URL when encryptionKey is provided", () => {
    const url = generateUrl({ sourceUrl: SRC }, { encryptionKey: KEY_HEX });

    expect(url).toMatch(/^\/_\/enc\//);
    const encPart = url.replace("/_/enc/", "");
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

    const encPart = url1.replace("/_/q:80/enc/", "");
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
      `"/vP_XaH5NRJAv08DJB8fC1FJqnAid8bt9uYgiX4UPLzc/rs:fill:480:360/enc/XNdtlrwvKuz5k1blTLNJxc2lHaNIK8oYXzPu89BKYD_AyGTTL1aIvY2tfvTWHxvH@webp"`,
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
