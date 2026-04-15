import {
  generateInfoUrl,
  generateUrl,
} from "@socialtip/asset-proxy-url-generator";
import { parseProcessingUrl } from "@socialtip/asset-proxy-url-parser";
import sharp from "sharp";

import { SOURCE_URL, toPng } from "./helpers.js";
import { CACHE_PROXY_URL, h2Fetch as fetch, URL_CONFIG } from "./setup.js";
import { VIDEO_SOURCE_URL } from "./video-helpers.js";

function cacheProxyUrl(insecurePath: string): string {
  const parsed = parseProcessingUrl(insecurePath);
  return `${CACHE_PROXY_URL}${generateUrl(parsed, URL_CONFIG)}`;
}

const COMPAT_HEADER = { "x-imgproxy-compat": "1" };

describe("imgproxy compat: video format best", () => {
  it("redirects video + f:best to webp thumbnail when compat header is set", async () => {
    const res = await fetch(
      cacheProxyUrl(
        `/insecure/f:best/rs:fill:480:360/plain/${VIDEO_SOURCE_URL}`,
      ),
      { headers: COMPAT_HEADER },
    );

    expect(res.status).toBe(301);
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(res.headers.get("location")).toMatchInlineSnapshot(
      `"/Eu_6EOaZ25Ql6dWOAqP-g0c1ByRqWZwQx1Dt4x7kDJ4/f:webp/rs:fill:480:360/vts:0/enc/N2NhNmFkMmYzOTFhNWJlMG-aK85gpH2N6VXLBfdqOMaeRyBpwhFQE9cJlUg88UAo_oU1deehUVUo4kSOlAitLA"`,
    );
  });

  it("redirects video + @best suffix to webp thumbnail when compat header is set", async () => {
    const res = await fetch(
      cacheProxyUrl(`/insecure/rs:fill:480:360/plain/${VIDEO_SOURCE_URL}@best`),
      { headers: COMPAT_HEADER },
    );

    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toMatchInlineSnapshot(
      `"/Eu_6EOaZ25Ql6dWOAqP-g0c1ByRqWZwQx1Dt4x7kDJ4/f:webp/rs:fill:480:360/vts:0/enc/N2NhNmFkMmYzOTFhNWJlMG-aK85gpH2N6VXLBfdqOMaeRyBpwhFQE9cJlUg88UAo_oU1deehUVUo4kSOlAitLA"`,
    );
  });

  it("does not redirect when compat header is absent", async () => {
    const res = await fetch(
      cacheProxyUrl(
        `/insecure/f:best/rs:fill:480:360/plain/${VIDEO_SOURCE_URL}`,
      ),
    );

    expect(res.status).toBe(200);
  });

  it("does not redirect image sources", async () => {
    const res = await fetch(
      cacheProxyUrl(`/insecure/f:best/w:100/plain/${SOURCE_URL}`),
      { headers: COMPAT_HEADER },
    );

    expect(res.status).toBe(200);
  });

  it("does not redirect video without best format", async () => {
    const res = await fetch(
      cacheProxyUrl(`/insecure/f:webp/vts:0/plain/${VIDEO_SOURCE_URL}`),
      { headers: COMPAT_HEADER },
    );

    expect(res.status).toBe(200);
  });

  it("does not redirect when video_thumbnail_second is already set", async () => {
    const res = await fetch(
      cacheProxyUrl(`/insecure/f:best/vts:5/plain/${VIDEO_SOURCE_URL}`),
      { headers: COMPAT_HEADER },
    );

    expect(res.status).toBe(200);
  });

  it("preserves all other options in the redirect URL", async () => {
    const res = await fetch(
      cacheProxyUrl(
        `/insecure/f:best/rs:fill:480:360/q:80/bl:5/plain/${VIDEO_SOURCE_URL}`,
      ),
      { headers: COMPAT_HEADER },
    );

    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toMatchInlineSnapshot(
      `"/_qFVvv-uumoRp79q-5N8Ru7QZK3jkfml6fKklQT5FD4/bl:5/f:webp/q:80/rs:fill:480:360/vts:0/enc/N2NhNmFkMmYzOTFhNWJlMG-aK85gpH2N6VXLBfdqOMaeRyBpwhFQE9cJlUg88UAo_oU1deehUVUo4kSOlAitLA"`,
    );
  });

  it("does not redirect /info requests", async () => {
    const infoUrl = generateInfoUrl(
      { sourceUrl: VIDEO_SOURCE_URL },
      URL_CONFIG,
    );
    const res = await fetch(`${CACHE_PROXY_URL}${infoUrl}`, {
      headers: COMPAT_HEADER,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ mime_type: expect.stringContaining("video") });
  });

  it("preserves encrypted source URL in the redirect", async () => {
    // cacheProxyUrl produces a signed+encrypted URL (enc/...)
    const res = await fetch(
      cacheProxyUrl(
        `/insecure/f:best/rs:fill:200:200/plain/${VIDEO_SOURCE_URL}`,
      ),
      { headers: COMPAT_HEADER },
    );

    expect(res.status).toBe(301);
    const location = res.headers.get("location")!;
    expect(location).toContain("/enc/");
    expect(location).not.toContain("/plain/");
    expect(location).toMatchInlineSnapshot(
      `"/CT6Pl81WbDMKmp9KlnVTqtiVE1XpNPDgtuTywpby-O0/f:webp/rs:fill:200:200/vts:0/enc/N2NhNmFkMmYzOTFhNWJlMG-aK85gpH2N6VXLBfdqOMaeRyBpwhFQE9cJlUg88UAo_oU1deehUVUo4kSOlAitLA"`,
    );

    // Follow the redirect — the signed encrypted URL should produce a webp thumbnail
    const redirectRes = await fetch(`${CACHE_PROXY_URL}${location}`, {
      // In practice, this header would still be here if it was injected e.g. by a load balancer
      headers: COMPAT_HEADER,
    });
    expect(redirectRes.status).toBe(200);
    expect(redirectRes.headers.get("content-type")).toBe("image/webp");
    const buffer = Buffer.from(await redirectRes.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    expect({ width: meta.width, height: meta.height }).toMatchInlineSnapshot(`
      {
        "height": 200,
        "width": 200,
      }
    `);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });
});
