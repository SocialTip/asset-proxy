import { verifySignature, sign } from "@socialtip/asset-proxy-url-parser";

const TEST_KEY = Buffer.from("736563726574", "hex"); // "secret"
const TEST_SALT = Buffer.from("68656c6c6f", "hex"); // "hello"

describe("verifySignature (keys configured)", () => {
  it("accepts a valid signature", () => {
    const path = "/resize:fill:480:360/plain/https://example.com/video.mp4";
    const signature = sign(path, TEST_KEY, TEST_SALT);

    const result = verifySignature(`/${signature}${path}`, {
      signingKey: TEST_KEY,
      signingSalt: TEST_SALT,
    });
    expect(result).toBe(path);
  });

  it("rejects an invalid signature", () => {
    expect(() =>
      verifySignature(
        "/badsignature/resize:fill:480:360/plain/https://example.com/video.mp4",
        { signingKey: TEST_KEY, signingSalt: TEST_SALT },
      ),
    ).toThrow("Invalid signature");
  });

  it("rejects a tampered path", () => {
    const path = "/resize:fill:480:360/plain/https://example.com/video.mp4";
    const signature = sign(path, TEST_KEY, TEST_SALT);
    const tampered = path.replace("480", "9999");

    expect(() =>
      verifySignature(`/${signature}${tampered}`, {
        signingKey: TEST_KEY,
        signingSalt: TEST_SALT,
      }),
    ).toThrow("Invalid signature");
  });
});
