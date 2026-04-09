import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateUrl } from "@socialtip/asset-proxy-url-generator";
import { parseProcessingUrl } from "@socialtip/asset-proxy-url-parser";
import sharp from "sharp";

import { h2Fetch as fetch, SERVICE_URL, URL_CONFIG } from "./setup.js";

async function toPng(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).png().toBuffer();
}

const SOURCE_URL = "http://file-server/test-image-with-metadata.jpg";

async function fetchToFile(path: string): Promise<string> {
  const parsed = parseProcessingUrl(`/insecure${path}/plain/${SOURCE_URL}`);
  const url = `${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`;
  const res = await fetch(url);
  expect(res.status).toBe(200);
  const buffer = Buffer.from(await res.arrayBuffer());
  const dir = mkdtempSync(join(tmpdir(), "asset-proxy-meta-"));
  const filePath = join(dir, "output.jpg");
  writeFileSync(filePath, buffer);
  return filePath;
}

function getExif(filePath: string): Record<string, string> {
  const raw = execSync(`exiftool -json "${filePath}"`, {
    encoding: "utf-8",
  });
  return JSON.parse(raw)[0];
}

describe("strip metadata (default: strip all, keep copyright)", () => {
  it("strips EXIF metadata by default", async () => {
    const filePath = await fetchToFile("/w:100");
    const exif = getExif(filePath);
    expect(exif.Make).toBeUndefined();
    expect(exif.Model).toBeUndefined();
    expect(exif.Artist).toBeUndefined();
    expect(exif.GPSLatitude).toBeUndefined();
  });

  it("preserves copyright by default", async () => {
    const filePath = await fetchToFile("/w:100");
    const exif = getExif(filePath);
    // Default: KEEP_COPYRIGHT=true, so copyright is preserved
    // (ffmpeg uses -map_metadata 0 when keepCopyright is true)
    expect(exif.Copyright).toBeDefined();
  });
});

describe("strip metadata options", () => {
  it("sm:0/scp:0 preserves all metadata including colour profile", async () => {
    const filePath = await fetchToFile("/w:100/sm:0/scp:0");
    const exif = getExif(filePath);
    expect(exif.Copyright).toBeDefined();
    expect(exif.Copyright).toMatchInlineSnapshot(`"(c) 2026 Test Copyright"`);
    expect(exif.Make).toBeDefined();
    expect(exif.Make).toMatchInlineSnapshot(`"TestCamera"`);
    expect(exif.ProfileDescription).toBeDefined();
    expect(exif.ProfileDescription).toMatchInlineSnapshot(
      `"sRGB IEC61966-2.1"`,
    );
  });

  it("sm:1/kcr:0 strips everything including copyright", async () => {
    const filePath = await fetchToFile("/w:100/sm:1/kcr:0");
    const exif = getExif(filePath);
    expect(exif.Make).toBeUndefined();
    expect(exif.Copyright).toBeUndefined();
  });

  it("sm:1/kcr:1 keeps copyright but strips other metadata", async () => {
    const filePath = await fetchToFile("/w:100/sm:1/kcr:1");
    const exif = getExif(filePath);
    expect(exif.Make).toBeUndefined();
    expect(exif.Copyright).toBeDefined();
    expect(exif.Copyright).toMatchInlineSnapshot(`"(c) 2026 Test Copyright"`);
  });

  it("scp:1 strips colour profile", async () => {
    const filePath = await fetchToFile("/w:100/sm:0/scp:1");
    const exif = getExif(filePath);
    expect(exif.ProfileDescription).toBeUndefined();
  });

  it("scp:0 preserves colour profile", async () => {
    const filePath = await fetchToFile("/w:100/sm:0/scp:0");
    const exif = getExif(filePath);
    expect(exif.ProfileDescription).toBeDefined();
    expect(exif.ProfileDescription).toMatchInlineSnapshot(
      `"sRGB IEC61966-2.1"`,
    );
  });
});

describe("dpi", () => {
  it("sets DPI metadata to 300", async () => {
    const filePath = await fetchToFile("/w:100/dpi:300");
    const exif = getExif(filePath);
    expect(exif.XResolution).toBe(300);
    expect(exif.YResolution).toBe(300);
  });

  it("sets DPI even when metadata is stripped", async () => {
    const filePath = await fetchToFile("/w:100/sm:1/kcr:0/dpi:150");
    const exif = getExif(filePath);
    expect(exif.XResolution).toBe(150);
    expect(exif.YResolution).toBe(150);
  });
});

describe("enforce_thumbnail", () => {
  it("extracts AVIF thumbnail when available", async () => {
    const parsed = parseProcessingUrl(
      "/insecure/eth:1/plain/http://file-server/test-image-with-thumbnail.avif@jpg",
    );
    const url = `${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const buffer = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(80);
    expect(meta.height).toBe(60);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("extracts HEIC thumbnail when available", async () => {
    // Main image is 100x100, thumbnail is 40x40
    const parsed = parseProcessingUrl(
      "/insecure/eth:1/plain/http://file-server/test-image-with-thumbnail.heic@jpg",
    );
    const url = `${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const buffer = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(40);
    expect(meta.height).toBe(40);
    expect(await toPng(buffer)).toMatchImageSnapshot();
  });

  it("falls back gracefully when no thumbnail exists", async () => {
    const filePath = await fetchToFile("/eth:1/w:100");
    const exif = getExif(filePath);
    expect(exif.ImageWidth).toBeDefined();
  });
});
