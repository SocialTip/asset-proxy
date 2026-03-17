import { verifySignature } from "../src/signature.js";

describe("verifySignature (keys not configured)", () => {
  it("accepts any signature value when keys are not set", () => {
    const result = verifySignature(
      "/anything/resize:fill:480:360/plain/https://example.com/video.mp4",
    );
    expect(result).toBe(
      "/resize:fill:480:360/plain/https://example.com/video.mp4",
    );
  });

  it("still requires the signature segment structurally", () => {
    expect(() => verifySignature("/nosegments")).toThrow(
      "Invalid URL: missing path segments",
    );
  });
});
