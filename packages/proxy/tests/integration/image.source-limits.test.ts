import { generateUrl } from "@socialtip/asset-proxy-url-generator";
import { parseProcessingUrl } from "@socialtip/asset-proxy-url-parser";

import { SOURCE_URL } from "./helpers.js";
import { h2Fetch as fetch, SERVICE_URL, URL_CONFIG } from "./setup.js";

describe("image source limits", () => {
  // test-image.png is 881 bytes, 200x150 = 0.03MP

  it("rejects when source file size exceeds max", async () => {
    const tooSmall = parseProcessingUrl(
      `/insecure/w:100/msfs:1/plain/${SOURCE_URL}`,
    );
    const res = await fetch(
      `${SERVICE_URL}${generateUrl(tooSmall, URL_CONFIG)}`,
    );
    expect(res.status).toBe(422);
    await expect(res.text()).resolves.toContain("Source file size");

    const generous = parseProcessingUrl(
      `/insecure/w:100/msfs:100000/plain/${SOURCE_URL}`,
    );
    const ok = await fetch(
      `${SERVICE_URL}${generateUrl(generous, URL_CONFIG)}`,
    );
    expect(ok.status).toBe(200);
  });

  it("rejects when source resolution exceeds max", async () => {
    const tooSmall = parseProcessingUrl(
      `/insecure/w:100/msr:0.01/plain/${SOURCE_URL}`,
    );
    const res = await fetch(
      `${SERVICE_URL}${generateUrl(tooSmall, URL_CONFIG)}`,
    );
    expect(res.status).toBe(422);
    await expect(res.text()).resolves.toContain("Source resolution");

    const generous = parseProcessingUrl(
      `/insecure/w:100/msr:1/plain/${SOURCE_URL}`,
    );
    const ok = await fetch(
      `${SERVICE_URL}${generateUrl(generous, URL_CONFIG)}`,
    );
    expect(ok.status).toBe(200);
  });
});
