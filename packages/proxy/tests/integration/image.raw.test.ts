import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { SOURCE_URL } from "./helpers.js";
import { SERVICE_URL } from "./setup.js";

const fixturesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures",
);

describe("raw passthrough", () => {
  it("returns the original image unmodified when raw:1 is set", async () => {
    const res = await fetch(
      `${SERVICE_URL}/insecure/raw:1/plain/${SOURCE_URL}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");

    const proxyBuffer = Buffer.from(await res.arrayBuffer());
    const sourceBuffer = readFileSync(resolve(fixturesDir, "test-image.png"));
    expect(proxyBuffer.equals(sourceBuffer)).toBe(true);
  });
});
