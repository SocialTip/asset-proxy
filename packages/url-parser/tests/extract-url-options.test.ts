import { extractUrlOptions, sign } from "@socialtip/asset-proxy-url-parser";

const SRC = "https://example.com/photo.jpg";
const SIGNING_KEY = Buffer.from("736563726574", "hex");
const SIGNING_SALT = Buffer.from("73616c74", "hex");

describe("extractUrlOptions", () => {
  it("extracts options from an unsigned URL", () => {
    const opts = extractUrlOptions(
      `/insecure/rs:fit:480:360/cdc:1/cors:1/plain/${SRC}`,
    );
    expect(opts).toMatchObject({
      resize: "fit:480:360",
      codec: "1",
      cors: "1",
    });
  });

  it("extracts options from a signed URL", () => {
    const path = `/rs:fill:200:200/cors:1/plain/${SRC}`;
    const sig = sign(path, SIGNING_KEY, SIGNING_SALT);
    const opts = extractUrlOptions(`/${sig}${path}`);
    expect(opts).toMatchInlineSnapshot(`
      {
        "LEfWFIFC2sh16Q1D8_fDUXSJiYkughd4GUSUKTwVvyo": "",
        "cors": "1",
        "resize": "fill:200:200",
      }
    `);
  });

  it("extracts options from an encrypted source URL", () => {
    const opts = extractUrlOptions(
      `/insecure/w:100/cors:1/enc/NzMyYzQzZGJhYjk5ZDBlZQ`,
    );
    expect(opts).toMatchObject({ width: "100", cors: "1" });
  });

  it("returns undefined for a path without /plain/ or /enc/", () => {
    expect(extractUrlOptions("/health")).toBeUndefined();
  });

  it("expands shorthands", () => {
    const opts = extractUrlOptions(`/insecure/mu:1/fr:30/plain/${SRC}`);
    expect(opts).toMatchObject({ mute: "1", framerate: "30" });
  });

  it("expands rt: shorthand to resizing_type", () => {
    const opts = extractUrlOptions(
      `/insecure/rt:fill/w:200/h:200/plain/${SRC}`,
    );
    expect(opts).toMatchObject({
      resizing_type: "fill",
      width: "200",
      height: "200",
    });
  });
});
