import { createHmac } from "node:crypto";

const TEST_KEY_HEX = "736563726574"; // "secret"
const TEST_SALT_HEX = "68656c6c6f"; // "hello"
const TEST_KEY = Buffer.from(TEST_KEY_HEX, "hex");
const TEST_SALT = Buffer.from(TEST_SALT_HEX, "hex");

function sign(path: string): string {
  const hmac = createHmac("sha256", TEST_KEY);
  hmac.update(TEST_SALT);
  hmac.update(path);
  return hmac.digest("base64url");
}

vi.hoisted(() => {
  process.env.SIGNING_KEY = "736563726574";
  process.env.SIGNING_SALT = "68656c6c6f";
});

const { verifySignature } = await import("../src/signature.js");

describe("verifySignature (keys configured)", () => {
  it("accepts a valid signature", () => {
    const path = "/resize:fill:480:360/plain/https://example.com/video.mp4";
    const signature = sign(path);

    const result = verifySignature(`/${signature}${path}`);
    expect(result).toBe(path);
  });

  it("rejects an invalid signature", () => {
    expect(() =>
      verifySignature(
        "/badsignature/resize:fill:480:360/plain/https://example.com/video.mp4",
      ),
    ).toThrow("Invalid signature");
  });

  it("rejects a tampered path", () => {
    const path = "/resize:fill:480:360/plain/https://example.com/video.mp4";
    const signature = sign(path);
    const tampered = path.replace("480", "9999");

    expect(() => verifySignature(`/${signature}${tampered}`)).toThrow(
      "Invalid signature",
    );
  });
});
